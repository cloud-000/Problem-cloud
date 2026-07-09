<script lang="ts">
   import type { PageData } from "./$types";
   import { goto } from "$app/navigation";
   import { Button } from "$lib/components/button";
   import { Icon } from "$lib/components/icon";
   import {
      DropdownMenu,
      type DropdownOption,
   } from "$lib/components/dropdown-menu";
   import { MathStatement } from "$lib/components/math-statement";
   import {
      ProblemAnswer,
      ProblemSolution,
      ProblemReview,
   } from "$lib/components/problem";
   import DebugInfo from "./DebugInfo.svelte";
   import { RatingCounter } from "$lib/components/rating-counter";
   import { RatingLifeBar } from "$lib/components/rating-life-bar";
   import { type TriState } from "$lib/components/toggle";
   import {
      DIFFICULTY_RANGE,
      boolToTri,
      topicLabel,
      triToBool,
      type ProblemRow,
      fetchAllSeries,
      fetchPlayerRating,
      fetchProblemRating,
      glickoExpectedScore,
      glickoMatchPreview,
      playerRatingIsProvisional,
      ratingIsProvisional,
      type PlayerRating,
      type ProblemRating,
   } from "$lib/library";
   import {
      ADAPTIVE_RANGE_DEFAULT,
      createSession,
      defaultPracticeSettings,
      fetchTestProblems,
      FORMAT_BEHAVIOR,
      nextPracticeProblem,
      type PracticeAttempt,
      type PracticeMode,
      type PracticeSettings,
      type PracticeSource,
      type ProblemProgress,
      type SessionFormat,
   } from "$lib/trainer";
   import { recordSubmission } from "$lib/progress";
   import {
      endSession,
      fetchSession,
      fetchSessionHistory,
      fetchOlderSubmission,
      fetchSessionProblemIds,
      getOrCreateRootSession,
      setCurrentProblem,
      updateSessionSettings,
      type PracticeSessionRow,
      type SessionHistoryEntry,
   } from "$lib/sessions";
   import { cn, formatElapsed, formatProblemText } from "$lib/utils";
   import { answersMatch, normalizeAnswer } from "$lib/utils/answer-matcher";
   import { modal } from "$lib/state/modal.svelte";
   import { toasts } from "$lib/state/toast.svelte";
   import AnswerSubmissionModal from "./AnswerSubmissionModal.svelte";
   import { SegmentBar } from "$lib/components/segment-bar";
   import { onMount } from "svelte";
   import { fade } from "svelte/transition";
   import SettingsPanel, {
      COUNTER_RANGE,
      type CounterEnabled,
      type CounterKey,
      type CounterRanges,
   } from "./SettingsPanel.svelte";
   import { TopbarRegister } from "$lib/components/topbar";
   import PauseOverlay from "./PauseOverlay.svelte";
   import MetadataBar from "./MetadataBar.svelte";

   // `sessionParam` is the `?session=` value: "root" (ungrouped work) or a
   // numeric session id. The parent route keys this component on it, so a
   // session switch fully remounts and resets all practice state.
   let { data, sessionParam }: { data: PageData; sessionParam: string } =
      $props();
   let { supabase, user } = $derived(data);

   let mode = $state<PracticeMode>("new");
   let topic = $state<string[]>([]);
   let difficulty = $state<[number, number]>([...DIFFICULTY_RANGE]);
   let verifiedOnly = $state(false);
   let computational = $state<TriState>("neutral");
   // off = With answer (default), neutral = Any, on = Without answer.
   let answerAvailability = $state<TriState>("off");
   // on = with solution, off = without, neutral = any (the default).
   let solutionAvailability = $state<TriState>("neutral");
   let seriesIds = $state<string[]>([]);
   let seriesOptions = $state<{ value: string; label: string }[]>([]);
   let counterRanges = $state<CounterRanges>({
      seen: [...COUNTER_RANGE],
      reviewed: [...COUNTER_RANGE],
      correct: [...COUNTER_RANGE],
      skipped: [...COUNTER_RANGE],
   });
   let counterEnabled = $state<CounterEnabled>({
      seen: false,
      reviewed: false,
      correct: false,
      skipped: false,
   });
   let lastSubmissionDays = $state<number | null>(null);
   let lastOutcome = $state<"any" | "correct" | "incorrect">("any");
   let includeUnscheduled = $state(false);
   // Adaptive difficulty: constrain draws to problems rated within ±range of the
   // player's live rating. On by default; the band is centered on `playerRating`
   // at draw time (inert until that rating loads / for unrated users).
   let adaptive = $state(true);
   let adaptiveRange = $state(ADAPTIVE_RANGE_DEFAULT);
   let showSettings = $state(false);
   let paused = $state(false);
   let focusMode = $state(false);

   // Session format. Resolved from the session's settings snapshot on mount and
   // then fixed for the life of the view ("practice" = the historical free-form
   // flow; "test" = work a whole test with deferred grading). Older snapshots
   // predate `format`, so a missing value is treated as "practice".
   let format = $state<SessionFormat>("practice");
   let testId = $state<number | null>(null);
   let timeLimitSeconds = $state<number | null>(null);
   let isTest = $derived(format === "test");
   let behavior = $derived(FORMAT_BEHAVIOR[format]);
   // Test lifecycle: true once the test has been submitted (or re-opened as an
   // already-ended test), which switches the view over to the results screen.
   let testFinished = $state(false);
   let focusModeActive = $derived(focusMode && !testFinished);
   let submittingTest = $state(false);

   // Progress-backed modes need per-user progress. Without a session, pin to New.
   $effect(() => {
      if (!user && mode !== "new") mode = "new";
   });

   // Cross-load draw state for interleaving and forward progress.
   const session = createSession();
   let currentSource = $state<PracticeSource>("practice");
   let currentProgress = $state<ProblemProgress | null>(null);

   // The DB-backed session this view is filing work into. null = root
   // (ungrouped). Resolved from `sessionParam` on mount; submissions carry its
   // id and the DB trigger maintains the session's aggregate counters.
   // `sessionAttemptCount` is a local tally for the live indicator (the stored
   // counters update server-side).
   let isRoot = $derived(sessionParam === "root");
   let activeSession = $state<PracticeSessionRow | null>(null);
   let currentSessionId = $derived(activeSession?.id ?? null);
   let sessionAttemptCount = $state(0);
   let sessionBusy = $state(false);

   // Outcome tallies carried over from prior work in a resumed session, added to
   // the live (in-memory) counts so the indicators reflect the whole session.
   let priorCorrect = $state(0);
   let priorIncorrect = $state(0);
   let priorSkipped = $state(0);
   // Time already accrued in this session before this run (the session's stored
   // total), added to the live per-problem times for the session-total display.
   let priorElapsedMs = $state(0);

   // Last settings snapshot persisted to the session, to skip redundant writes.
   let lastPersistedSettings = "";

   // Write a stored PracticeSettings snapshot back into the panel's bound state
   // (the inverse of currentSettings()), so resuming a session restores its
   // filters. Merged over the canonical defaults so an empty `{}` snapshot (a
   // freshly created root session) or any older partial snapshot can't leave a
   // required field undefined (the spreads below would otherwise throw).
   function applySettings(raw: PracticeSettings) {
      const s = { ...defaultPracticeSettings(), ...raw };
      format = s.format ?? "practice";
      testId = s.testId ?? null;
      timeLimitSeconds = s.timeLimitSeconds ?? null;
      focusMode = s.focusMode ?? false;
      triesPerProblem = s.triesPerProblem ?? 2;
      seriesIds = s.seriesIds ? [...s.seriesIds] : [];
      mode = s.mode;
      topic = [...s.topic];
      difficulty = [s.difficulty[0], s.difficulty[1]];
      verifiedOnly = s.verifiedOnly;
      computational = boolToTri(s.computational);
      answerAvailability =
         s.answerAvailability === "without"
            ? "on"
            : s.answerAvailability === "any"
              ? "neutral"
              : "off";
      solutionAvailability =
         s.solutionAvailability === "with"
            ? "on"
            : s.solutionAvailability === "without"
              ? "off"
              : "neutral";
      const applyCounter = (
         key: CounterKey,
         range: [number, number] | null,
      ) => {
         counterEnabled[key] = range != null;
         counterRanges[key] = range ? [range[0], range[1]] : [...COUNTER_RANGE];
      };
      applyCounter("seen", s.timesSeen);
      applyCounter("reviewed", s.timesReviewed);
      applyCounter("correct", s.timesCorrect);
      applyCounter("skipped", s.timesSkipped);
      lastSubmissionDays = s.lastSubmissionDays;
      lastOutcome = s.lastOutcome;
      includeUnscheduled = s.includeUnscheduled;
      adaptive = s.adaptive ?? true;
      adaptiveRange = s.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT;
   }

   async function finishSession() {
      if (!activeSession || isRoot || sessionBusy) return;
      sessionBusy = true;
      try {
         await endSession(supabase, activeSession.id);
         await goto("/practice");
      } catch (e) {
         error = (e as Error).message;
         sessionBusy = false;
      }
   }

   // ---- Test format ----------------------------------------------------------

   // Draft answers for an in-progress test live client-side (localStorage) until
   // the test is submitted: grading is deferred and submissions are append-only,
   // so there is nowhere server-side to stash unsubmitted answers.
   type TestDraftAnswer = {
      problemId: number;
      selectedChoice: number | null;
      answer: string;
      elapsedMs: number;
      flagged: boolean;
   };
   type TestDraft = { historyIndex: number; answers: TestDraftAnswer[] };

   function testDraftKey(sessionId: number) {
      return `pc:test-draft:${sessionId}`;
   }

   function loadTestDraft(sessionId: number): TestDraft | null {
      try {
         const raw = localStorage.getItem(testDraftKey(sessionId));
         return raw ? (JSON.parse(raw) as TestDraft) : null;
      } catch {
         return null;
      }
   }

   // Snapshot the current live answer + every history entry to localStorage.
   // Uses the live vars for the on-screen entry (not yet committed) so a reload
   // never loses the answer being worked on. Non-reactive; safe to call anywhere.
   function writeTestDraft() {
      if (currentSessionId == null) return;
      const answers: TestDraftAnswer[] = history.map((e, i) =>
         i === historyIndex
            ? {
                 problemId: e.problem.id,
                 selectedChoice,
                 answer,
                 elapsedMs: liveElapsed(),
                 flagged,
              }
            : {
                 problemId: e.problem.id,
                 selectedChoice: e.selectedChoice,
                 answer: e.answer,
                 elapsedMs: e.elapsedMs,
                 flagged: e.flagged,
              },
      );
      try {
         localStorage.setItem(
            testDraftKey(currentSessionId),
            JSON.stringify({ historyIndex, answers } satisfies TestDraft),
         );
      } catch {
         // Storage unavailable/full — drafts are best-effort.
      }
   }

   function clearTestDraft(sessionId: number) {
      try {
         localStorage.removeItem(testDraftKey(sessionId));
      } catch {
         // ignore
      }
   }

   // Build the test's problem set (or the results, if already submitted) into the
   // history model. Unlike practice, the whole ordered set is known up front and
   // every entry stays editable until the single final submission.
   async function initTest(s: PracticeSessionRow) {
      loading = true;
      try {
         if (testId == null) {
            problem = null;
            return;
         }

         // A test is "submitted" once its graded rows exist. The session's
         // `ended` status can lag — a prior submit may have recorded the rows
         // but failed to end the session — so detect completion from the
         // submissions themselves, not just status, and render the results.
         const graded = await fetchSessionHistory(supabase, s.id);
         if (s.status === "ended" || graded.length > 0) {
            // fetchSessionHistory orders by created_at, but a test's rows are
            // batch-inserted with identical timestamps, so that order is
            // arbitrary. Re-sort into problem order for the review list.
            const ordered = [...graded].sort(
               (x, y) =>
                  x.problem.n - y.problem.n || x.problem.id - y.problem.id,
            );
            history = ordered.map((a) => ({
               problem: a.problem,
               source: "practice" as PracticeSource,
               progress: null,
               selectedChoice: a.selectedChoice,
               answer: "",
               submitted: !a.skipped,
               correct: a.isCorrect,
               flagged: a.flagged,
               elapsedMs: a.elapsedMs,
               attemptIndex: null,
               triesUsed: 0,
               triedAnswers: [],
               eliminatedChoices: [],
            }));
            historyIndex = history.length - 1;
            testFinished = true;
            // Reconcile a session left active by a submit whose end-of-session
            // call failed; grading already happened, so this just flips status.
            if (s.status !== "ended") {
               endSession(supabase, s.id).catch((e) =>
                  console.error("Failed to reconcile test session:", e),
               );
            }
            return;
         }

         // Fresh / in-progress test: all problems, in order, editable.
         const problems = await fetchTestProblems(supabase, testId);
         history = problems.map((p) => ({
            problem: p,
            source: "practice" as PracticeSource,
            progress: null,
            selectedChoice: null,
            answer: "",
            submitted: false,
            correct: null,
            flagged: false,
            elapsedMs: 0,
            attemptIndex: null,
            triesUsed: 0,
            triedAnswers: [],
            eliminatedChoices: [],
         }));

         // Restore any in-progress draft (answers + per-problem time + place).
         const draft = loadTestDraft(s.id);
         if (draft) {
            const byId = new Map(draft.answers.map((a) => [a.problemId, a]));
            for (const e of history) {
               const a = byId.get(e.problem.id);
               if (!a) continue;
               e.selectedChoice = a.selectedChoice;
               e.answer = a.answer ?? "";
               e.elapsedMs = a.elapsedMs ?? 0;
               e.flagged = a.flagged ?? false;
            }
         }

         if (history.length > 0) {
            const start =
               draft &&
               draft.historyIndex >= 0 &&
               draft.historyIndex < history.length
                  ? draft.historyIndex
                  : 0;
            restore(start);
         }
      } catch (e) {
         error = (e as Error).message;
      } finally {
         loading = false;
      }
   }

   // Grade every problem at once, batch-insert the submissions (the DB trigger
   // drives problem_progress + session aggregates per row), end the session, and
   // flip to the results screen.
   async function submitTest() {
      if (behavior.gradeImmediately || testFinished || submittingTest) return;
      submittingTest = true;
      // Snapshot the live timer/answer into the on-screen entry *before*
      // flipping `testFinished` — that derives `timerRunning` to false, which
      // would freeze `liveElapsed()` and drop the time spent on this problem.
      commitCurrent();
      testFinished = true; // lock the UI immediately
      try {
         if (user && currentSessionId != null) {
            const rows = history.map((e) => {
               const isMcq = (e.problem.choices?.length ?? 0) > 1;
               const skipped = isMcq
                  ? e.selectedChoice == null
                  : !e.answer || !e.answer.trim();
               const isCorrect = skipped
                  ? null
                  : isMcq
                    ? e.selectedChoice === e.problem.answer_index
                    : e.answer.trim() ===
                      e.problem.choices?.[e.problem.answer_index ?? 0]?.trim();
               // Reflect the grade on the entry for the results screen.
               e.submitted = !skipped;
               e.correct = isCorrect;
               return {
                  user_id: user.id,
                  problem_id: e.problem.id,
                  selected_choice: e.selectedChoice,
                  is_correct: isCorrect,
                  skipped,
                  flagged: e.flagged,
                  elapsed_ms: Math.max(0, Math.round(e.elapsedMs)),
                  source: "test",
                  session_id: currentSessionId,
               };
            });
            // Record the graded submissions. Idempotency is enforced in the
            // DB by a partial unique index on (session_id, problem_id) where
            // source = 'test': a retried or concurrent submit (a reload after
            // a failed session-end, or a second tab) collides with the
            // constraint and the whole batch rolls back atomically. This
            // replaces a count-then-insert check that could race two submits
            // past the guard and double-count every row.
            if (rows.length > 0) {
               const { error: insertError } = await supabase
                  .from("submissions")
                  .insert(rows);
               // 23505 = unique_violation: the grades are already recorded
               // (a prior attempt or another tab won), so treat it as an
               // already-submitted success rather than an error.
               if (insertError && insertError.code !== "23505") {
                  throw insertError;
               }
            }
            // Grades are in, so the local draft is obsolete — drop it now, not
            // after endSession, so a failed end can't strand stale answers
            // that a resubmit would silently discard.
            clearTestDraft(currentSessionId);
            // Ending the session is a status flip, not part of grading: if it
            // fails the grades still stand, so don't surface it as a submit
            // failure (which would send the user back to an editable test).
            // initTest re-ends the session from the recorded grades next open.
            endSession(supabase, currentSessionId).catch((e) =>
               console.error("Failed to end test session:", e),
            );
         }
      } catch (e) {
         error = (e as Error).message;
      } finally {
         submittingTest = false;
      }
   }

   // Persist / clear the session's in-progress problem (fire-and-forget). The
   // pointer is set when a problem is shown and cleared once it's answered or
   // skipped (it then lives in `submissions`).
   function persistCurrentProblem(problemId: number, elapsedMs: number) {
      if (currentSessionId == null) return;
      setCurrentProblem(supabase, currentSessionId, problemId, elapsedMs).catch(
         (e) => console.error("Failed to persist session problem:", e),
      );
   }
   function clearCurrentProblem() {
      if (currentSessionId == null) return;
      setCurrentProblem(supabase, currentSessionId, null, 0).catch((e) =>
         console.error("Failed to clear session problem:", e),
      );
   }

   // Fetch a single problem with its embedded test/series (matches the trainer's
   // select), to resume a session's in-progress problem by id.
   async function fetchProblemById(id: number): Promise<ProblemRow | null> {
      const { data, error: e } = await supabase
         .from("problems")
         .select("*, tests(name, series_id, series(name))")
         .eq("id", id)
         .maybeSingle();
      if (e) throw e;
      return (data as unknown as ProblemRow | null) ?? null;
   }

   // Present an already-chosen problem as the live (latest) entry, seeding its
   // elapsed time — used to resume the in-progress problem on session open.
   function showProblem(
      p: ProblemRow,
      source: PracticeSource,
      progress: ProblemProgress | null,
      elapsedMs: number,
   ) {
      commitCurrent();
      error = null;
      session.shownIds.add(p.id);
      session.drawIndex += 1;
      history = [
         ...history,
         {
            problem: p,
            source,
            progress,
            selectedChoice: null,
            answer: "",
            submitted: false,
            correct: null,
            flagged: false,
            elapsedMs,
            attemptIndex: null,
            triesUsed: 0,
            triedAnswers: [],
            eliminatedChoices: [],
         },
      ];
      restore(history.length - 1);
      loading = false;
      paused = false;
   }

   // Browser-history-style navigation: every generated problem is appended to
   // `history`; `historyIndex` points at the one on screen. Past entries are
   // frozen snapshots; only the latest entry is live (timer runs, answerable).
   // Entries paged in from the server carry a `submissionId` (the back-paging
   // cursor); problems drawn this run do not.
   type HistoryEntry = {
      problem: ProblemRow;
      source: PracticeSource;
      progress: ProblemProgress | null;
      selectedChoice: number | null;
      answer: string;
      submitted: boolean;
      correct: boolean | null;
      flagged: boolean;
      elapsedMs: number;
      attemptIndex: number | null;
      triesUsed: number;
      triedAnswers: string[];
      eliminatedChoices: number[];
      submissionId?: number;
   };
   let history = $state<HistoryEntry[]>([]);
   let historyIndex = $state(-1);

   // Root ("practice freely") lazy back-paging. `olderPrefetch` holds the single
   // problem immediately older than history[0], fetched ahead so Back's
   // enabled-state is known and stepping back is instant; its `submissionId` is
   // the cursor for paging further back. `olderExhausted` marks the start of
   // history reached.
   let olderPrefetch = $state<HistoryEntry | null>(null);
   let olderExhausted = $state(false);
   let olderLoading = $state(false);

   let problem = $state<ProblemRow | null>(null);
   let debugMode = $state(false);
   let showRawLatex = $state(false);
   let loading = $state(true);
   let error = $state<string | null>(null);
   let selectedChoice = $state<number | null>(null);
   // MCQ choices the user has crossed out on the on-screen problem. Carried on
   // the history entry so back/forward navigation preserves it; resets per
   // problem. Never persisted to the DB.
   let eliminatedChoices = $state<number[]>([]);
   let answer = $state("");
   let submitted = $state(false);
   let correct = $state<boolean | null>(null);
   let flagged = $state(false);
   // Once a finalized problem has solutions to show, the statement/answer collapse
   // to their natural height (no vertical fill) so the solution panel gets the rest.
   let solutionShown = $derived(
      submitted && (problem?.official_solutions?.length ?? 0) > 0,
   );
   let startedAt = $state(Date.now());
   let timerNow = $state(Date.now());
   let frozenElapsedMs = $state(0);
   let attempts = $state<PracticeAttempt[]>([]);
   let currentAttemptIndex = $state<number | null>(null);

   // Multi-try practice: how many attempts are allowed per problem, how many
   // have been spent on the on-screen problem, and the (in-memory) set of
   // answers already tried for it. Re-submitting a tried answer is rejected and
   // does not consume a try. Reset per problem; carried on the history entry so
   // back/forward navigation preserves the count.
   let triesPerProblem = $state(2);
   let triesUsed = $state(0);
   let triedAnswers = $state<string[]>([]);
   // Component ref for the answer UI, so a wrong-but-not-final attempt can flash
   // the shake/feedback animation without revealing the correct answer.
   let answerFeedback = $state<ProblemAnswer | null>(null);
   let triesRemaining = $derived(Math.max(0, triesPerProblem - triesUsed));

   let loadToken = 0;

   let isLatest = $derived(historyIndex === history.length - 1);
   // Back is available either within the materialized history, or when a previous
   // problem has been prefetched from the server (any session).
   let canGoBack = $derived(historyIndex > 0 || olderPrefetch != null);
   let isProblemMcq = $derived(!!problem && (problem.choices?.length ?? 0) > 1);
   let cannotSubmit = $derived(
      !problem ||
         paused ||
         (isProblemMcq ? selectedChoice == null : !answer.trim()),
   );

   let moreOptions = $derived<DropdownOption[]>([
      {
         label: focusMode ? "Disable Focus Mode" : "Focus Mode",
         icon: focusMode ? "center_focus_strong" : "center_focus_weak",
         iconFill: focusMode,
         onclick: () => setFocusMode(!focusMode),
      },
      {
         type: "divider",
      },
      {
         label: flagged ? "Unflag" : "Flag",
         icon: "flag",
         iconFill: flagged,
         color: flagged ? "text-unsure" : undefined,
         disabled: paused,
         onclick: () => toggleFlag(),
      },
      {
         label: "Report",
         icon: "report",
         onclick: () => {},
      },
      {
         label: "Share",
         icon: "share",
         onclick: () => {},
      },
      {
         type: "divider",
      },
      {
         label: debugMode ? "Disable Debug" : "Debug",
         icon: "bug_report",
         onclick: () => {
            debugMode = !debugMode;
         },
      },
   ]);

   // Elapsed time for the on-screen problem at a given clock reading: the live
   // count for the latest unanswered one, otherwise its frozen value. `elapsedMs`
   // passes the reactive (throttled) `timerNow` to drive the ticking display;
   // `liveElapsed()` passes a fresh `Date.now()` for an exact, non-reactive
   // snapshot at event/persist time (so those paths don't subscribe to the timer).
   // Whether the on-screen problem's clock is currently ticking. In practice only
   // the latest, unanswered, unpaused problem runs; in a test the clock runs for
   // whatever problem is shown until the test is submitted (every problem stays
   // answerable, and time accrues to whichever one is on screen).
   let timerRunning = $derived(
      !!problem &&
         !loading &&
         !paused &&
         // Formats that freeze on navigate only tick the latest, unanswered
         // problem; non-freezing formats (test) tick whatever is shown until
         // the run is finished.
         (behavior.freezeOnNavigate ? !submitted && isLatest : !testFinished),
   );

   function elapsedAt(now: number) {
      return timerRunning ? Math.max(0, now - startedAt) : frozenElapsedMs;
   }

   let elapsedMs = $derived(elapsedAt(timerNow));

   // Total time across the whole session: the session's stored prior total plus
   // every problem drawn in this run (substituting the live count for the
   // on-screen one). Older problems paged in for back-navigation (those carrying
   // a `submissionId`) are already counted in the stored total, so they're
   // excluded here to avoid double-counting.
   let totalElapsedMs = $derived(
      history.reduce(
         (sum, entry, i) =>
            entry.submissionId != null
               ? sum
               : sum + (i === historyIndex ? elapsedMs : entry.elapsedMs),
         priorElapsedMs,
      ),
   );
   // The timer chip swaps between the current problem and the session total.
   let timerMode = $state<"problem" | "total">("problem");

   // Test countdown: time left from the limit, or null when untimed (count up).
   let remainingMs = $derived(
      timeLimitSeconds == null
         ? null
         : Math.max(0, timeLimitSeconds * 1000 - totalElapsedMs),
   );

   // Total time across the test from the committed per-problem values (no live
   // substitution) — used for the results summary once submitted.
   let testElapsedTotalMs = $derived(
      history.reduce((sum, e) => sum + e.elapsedMs, 0),
   );

   // The pinned test's display name (from the problems' joined test).
   let testName = $derived(
      isTest ? (history[0]?.problem.tests?.name ?? null) : null,
   );

   // Test results tallies (meaningful once `testFinished`).
   let testCorrect = $derived(history.filter((e) => e.correct === true).length);
   let testIncorrect = $derived(
      history.filter((e) => e.submitted && e.correct === false).length,
   );
   let testSkipped = $derived(
      history.filter((e) => {
         const isMcq = (e.problem.choices?.length ?? 0) > 1;
         return isMcq
            ? e.selectedChoice == null
            : !e.answer || !e.answer.trim();
      }).length,
   );

   let completedAttempts = $derived(
      attempts.filter((attempt) => attempt.correct !== null),
   );
   let liveCorrect = $derived(
      completedAttempts.filter((attempt) => attempt.correct).length,
   );
   // Session totals: prior work (seeded on resume) plus this view's live counts.
   let correctAttempts = $derived(priorCorrect + liveCorrect);
   let incorrectAttempts = $derived(
      priorIncorrect + (completedAttempts.length - liveCorrect),
   );
   let skippedAttempts = $derived(
      priorSkipped + attempts.filter((attempt) => attempt.skipped).length,
   );

   // Shared class for inline (text-sized) icons throughout the view.
   const iconCls = "size-[1em] shrink-0 leading-none opacity-70";
   // A problem with no recorded answer (answer_index -1 or null) — runs in
   // ungraded mode and surfaces the "No answer" submission chip.
   let hasAnswer = $derived(
      !!problem && problem.answer_index != null && problem.answer_index >= 0,
   );

   function openAnswerSubmission() {
      if (!problem) return;
      if (!user) {
         toasts.error("Sign in to suggest an answer.");
         return;
      }
      modal.show(
         AnswerSubmissionModal,
         {
            supabase,
            user,
            problemId: problem.id,
            choices: problem.choices ?? [],
         },
         { title: "Suggest an answer", size: "md" },
      );
   }

   function counterFilter(key: keyof CounterRanges): [number, number] | null {
      return counterEnabled[key] ? [...counterRanges[key]] : null;
   }

   function currentSettings(): PracticeSettings {
      return {
         mode,
         format,
         testId,
         timeLimitSeconds,
         focusMode,
         triesPerProblem,
         seriesIds: [...seriesIds],
         topic: [...topic],
         difficulty: [difficulty[0], difficulty[1]],
         verifiedOnly,
         computational: triToBool(computational),
         answerAvailability:
            answerAvailability === "on"
               ? "without"
               : answerAvailability === "neutral"
                 ? "any"
                 : "with",
         solutionAvailability:
            solutionAvailability === "on"
               ? "with"
               : solutionAvailability === "off"
                 ? "without"
                 : "any",
         timesSeen: counterFilter("seen"),
         timesReviewed: counterFilter("reviewed"),
         timesCorrect: counterFilter("correct"),
         timesSkipped: counterFilter("skipped"),
         lastSubmissionDays,
         lastOutcome,
         includeUnscheduled,
         adaptive,
         adaptiveRange,
      };
   }

   function persistSettingsSnapshot(settings = currentSettings()) {
      if (currentSessionId == null) return;
      const serialized = JSON.stringify(settings);
      if (serialized === lastPersistedSettings) return;
      lastPersistedSettings = serialized;
      updateSessionSettings(supabase, currentSessionId, settings).catch((e) =>
         console.error("Failed to persist session settings:", e),
      );
   }

   function setFocusMode(value: boolean) {
      focusMode = value;
      persistSettingsSnapshot({ ...currentSettings(), focusMode: value });
   }

   // Exact, non-reactive elapsed snapshot for event handlers / persistence.
   function liveElapsed() {
      return elapsedAt(Date.now());
   }

   // Save the live view state back into its history entry before navigating away.
   function commitCurrent() {
      // Leaving the current problem: finish the life-bar's change animation now
      // so its tween/decay tail doesn't play out on the next problem.
      ratingBar?.settle();
      const entry = history[historyIndex];
      if (!entry) return;
      entry.selectedChoice = selectedChoice;
      entry.answer = answer;
      entry.submitted = submitted;
      entry.correct = correct;
      entry.flagged = flagged;
      entry.elapsedMs = liveElapsed();
      entry.attemptIndex = currentAttemptIndex;
      entry.triesUsed = triesUsed;
      entry.triedAnswers = triedAnswers;
      entry.eliminatedChoices = eliminatedChoices;
   }

   // Load a history entry into the live view. The timer only resumes for the
   // latest unanswered entry; everything else is shown frozen.
   function restore(index: number) {
      const entry = history[index];
      if (!entry) return;
      historyIndex = index;
      problem = entry.problem;
      currentSource = entry.source;
      currentProgress = entry.progress;
      selectedChoice = entry.selectedChoice;
      answer = entry.answer;
      submitted = entry.submitted;
      correct = entry.correct;
      flagged = entry.flagged;
      currentAttemptIndex = entry.attemptIndex;
      triesUsed = entry.triesUsed;
      triedAnswers = entry.triedAnswers;
      eliminatedChoices = entry.eliminatedChoices;

      const now = Date.now();
      timerNow = now;
      frozenElapsedMs = entry.elapsedMs;
      startedAt = now - entry.elapsedMs;
   }

   // Build a live history entry from a stored/fetched submission. Paged-in older
   // entries carry their `submissionId` (the back-paging cursor); freshly drawn
   // problems have none.
   function historyEntryFrom(
      a: SessionHistoryEntry & { submissionId?: number },
   ): HistoryEntry {
      return {
         problem: a.problem,
         source: (a.source as PracticeSource) ?? "practice",
         progress: null,
         selectedChoice: a.selectedChoice,
         answer: "",
         submitted: !a.skipped,
         correct: a.isCorrect,
         flagged: a.flagged,
         elapsedMs: a.elapsedMs,
         attemptIndex: null,
         triesUsed: 0,
         triedAnswers: [],
         eliminatedChoices: [],
         submissionId: a.submissionId,
      };
   }

   async function loadProblem(settings = currentSettings()) {
      const token = ++loadToken;
      const now = Date.now();

      // Persist settings changes back to the active session so a later resume
      // restores them. Fire-and-forget; deduped against the last write.
      persistSettingsSnapshot(settings);

      commitCurrent();

      loading = true;
      error = null;
      problem = null;
      selectedChoice = null;
      answer = "";
      submitted = false;
      correct = null;
      flagged = false;
      currentAttemptIndex = null;
      triesUsed = 0;
      triedAnswers = [];
      eliminatedChoices = [];
      frozenElapsedMs = 0;
      startedAt = now;
      timerNow = now;
      paused = false;

      try {
         const result = await nextPracticeProblem(
            supabase,
            settings,
            session,
            playerRating?.rating ?? null,
         );
         if (token !== loadToken) return;

         if (result.problem) {
            session.shownIds.add(result.problem.id);
            session.drawIndex += 1;

            history = [
               ...history,
               {
                  problem: result.problem,
                  source: result.source,
                  progress: result.progress,
                  selectedChoice: null,
                  answer: "",
                  submitted: false,
                  correct: null,
                  flagged: false,
                  elapsedMs: 0,
                  attemptIndex: null,
                  triesUsed: 0,
                  triedAnswers: [],
                  eliminatedChoices: [],
               },
            ];
            restore(history.length - 1);
            // Remember the in-progress problem so a resume continues it.
            persistCurrentProblem(result.problem.id, 0);
         } else {
            problem = null;
            currentSource = result.source;
            currentProgress = null;
         }
      } catch (e) {
         if (token !== loadToken) return;
         error = (e as Error).message;
         frozenElapsedMs = Date.now() - now;
      } finally {
         if (token === loadToken) loading = false;
      }
   }

   // Forget which problems were shown this session so the queue can cycle
   // through them again (e.g. after exhausting the due-review queue, problems
   // that were skipped and are still due become eligible once more).
   function resetSession() {
      session.shownIds.clear();
      session.drawIndex = 0;
      loadProblem();
   }

   // A normalized key identifying the currently-entered answer, used to detect a
   // repeat of an already-tried answer. null when nothing is entered.
   function currentAnswerKey(): string | null {
      if (isProblemMcq) {
         return selectedChoice == null ? null : `c:${selectedChoice}`;
      }
      const normalized = normalizeAnswer(answer);
      return normalized ? `a:${normalized}` : null;
   }

   // Live skill-rating feedback: baseline fetched on mount, refreshed after a
   // graded submission lands (the DB trigger rates it in the same insert).
   // `ratingDelta` is the change from the last known rating, shown in the
   // footer next to the fresh result.
   let playerRating = $state<PlayerRating | null>(null);
   let ratingDelta = $state<number | null>(null);
   // Life-bar instance, so navigation can finish its change animation instantly
   // instead of letting the tween tail bleed onto the next problem.
   let ratingBar = $state<{ settle: () => void }>();
   // Guards playerRating writes against out-of-order resolution: a graded
   // wrong try followed quickly by a correct one fires two overlapping
   // fetches, and the onMount baseline fetch can straggle behind both. Only
   // the most recently-initiated fetch may win.
   let playerRatingSeq = 0;

   // The current problem's Glicko rating, for the metadata-row elo and the debug
   // panel's match preview. Trainer draws don't embed ratings, so fetch by id
   // whenever the shown problem changes; guard against out-of-order resolves.
   let problemRating = $state<ProblemRating | null>(null);
   $effect(() => {
      const id = problem?.id;
      problemRating = null;
      if (id == null) return;
      let current = true;
      fetchProblemRating(supabase, id)
         .then((r) => {
            if (current) problemRating = r;
         })
         .catch((e) => console.error("Failed to fetch problem rating:", e));
      return () => {
         current = false;
      };
   });

   // Live matchup for the metadata-row rating bar: the player's Glicko-expected
   // solve chance for the on-screen problem. Needs both ratings, each of which
   // appears with its first graded submission (null until then).
   let expectedScore = $derived(
      playerRating && problemRating
         ? glickoExpectedScore(
              playerRating.rating,
              problemRating.rating,
              problemRating.rd,
           )
         : null,
   );

   function refreshPlayerRating(after: Promise<void>, userId: string) {
      const before = playerRating?.rating ?? null;
      const seq = ++playerRatingSeq;
      after
         .then(() => fetchPlayerRating(supabase, userId))
         .then((r) => {
            if (!r || seq !== playerRatingSeq) return;
            ratingDelta = before != null ? r.rating - before : null;
            playerRating = r;
         })
         .catch((e) => console.error("Failed to refresh player rating:", e));
   }

   function submitAnswer() {
      // Per-answer grading is only for formats that grade immediately; test
      // defers all grading to submitTest().
      if (!behavior.gradeImmediately) return;
      if (!problem || submitted || paused) return;
      if (isProblemMcq && selectedChoice == null) return;
      if (!isProblemMcq && !answer.trim()) return;

      // Reject a repeat of a previously-tried answer: flash feedback but don't
      // consume a try — the user simply hasn't offered anything new.
      const key = currentAnswerKey();
      if (key != null && triedAnswers.includes(key)) {
         answerFeedback?.trigger(true);
         toasts.warning("You already tried that answer.");
         return;
      }

      const elapsed = Math.max(0, Date.now() - startedAt);
      // Answerless problems run ungraded: there's nothing to compare against,
      // so record the attempt as seen-but-not-graded (isCorrect = null).
      const isCorrect = hasAnswer
         ? isProblemMcq
            ? selectedChoice === problem.answer_index
            : answersMatch(
                 answer,
                 problem.choices?.[problem.answer_index ?? 0] ?? "",
              )
         : null;

      // Multi-try: a graded wrong answer with tries still remaining doesn't
      // finalize the problem. Remember the tried answer, flash the shake
      // feedback (without revealing the correct answer), and let the user retry.
      // Correct answers and ungraded problems always finalize on submit.
      if (isCorrect === false && triesUsed + 1 < triesPerProblem) {
         if (key != null) triedAnswers = [...triedAnswers, key];
         triesUsed += 1;
         answerFeedback?.trigger(true);
         return;
      }

      submitted = true;
      correct = isCorrect;
      frozenElapsedMs = elapsed;
      currentAttemptIndex = attempts.length;
      attempts = [
         ...attempts,
         {
            problemId: problem.id,
            selectedChoice,
            correct: isCorrect,
            elapsedMs: elapsed,
            skipped: false,
            flagged,
         },
      ];

      if (user) {
         const recorded = recordSubmission(supabase, user.id, {
            problemId: problem.id,
            selectedChoice,
            isCorrect,
            skipped: false,
            flagged,
            elapsedMs: elapsed,
            source: currentSource,
            sessionId: currentSessionId,
            // Wrong tries burned before this final outcome (0 = first-try).
            triesUsed,
         });
         // Graded attempts are rated live; surface the rating movement.
         if (isCorrect !== null) {
            ratingDelta = null;
            refreshPlayerRating(recorded, user.id);
         }
         if (currentSessionId != null) {
            sessionAttemptCount += 1;
            clearCurrentProblem(); // answered → now lives in submissions
         }
      }
   }

   // Record a skip for the current problem (counts toward stats + progress),
   // without advancing — the caller decides what to load next.
   function recordSkip() {
      if (!problem) return;

      const elapsed = liveElapsed();
      currentAttemptIndex = attempts.length;
      attempts = [
         ...attempts,
         {
            problemId: problem.id,
            selectedChoice,
            correct: null,
            elapsedMs: elapsed,
            skipped: true,
            flagged,
         },
      ];

      if (user) {
         recordSubmission(supabase, user.id, {
            problemId: problem.id,
            selectedChoice: null,
            isCorrect: null,
            skipped: true,
            flagged,
            elapsedMs: elapsed,
            source: currentSource,
            sessionId: currentSessionId,
         });
         if (currentSessionId != null) {
            sessionAttemptCount += 1;
            clearCurrentProblem(); // skipped → now lives in submissions
         }
      }
   }

   function goBack() {
      if (!canGoBack || loading) return;
      commitCurrent();
      // Within the materialized history, just step back. At the oldest
      // materialized entry, `canGoBack` guarantees (root) a prefetched
      // server-older entry to step into instead.
      if (historyIndex > 0) {
         restore(historyIndex - 1);
      } else {
         consumeOlder();
      }
   }

   // Fetch the single problem immediately older than history[0] (any session), so
   // the Back button's state is known and stepping back is instant. Guarded so
   // exactly one is held ahead; the cursor walks strictly backwards by id, so
   // problems drawn this run (ids above the newest submission at mount) are never
   // re-paged. Fired once on start and again after each step further back. Skipped
   // for tests (fixed set) and signed-out/ephemeral practice (no session).
   async function prefetchOlder() {
      if (currentSessionId == null || !user || isTest) return;
      if (olderLoading || olderPrefetch || olderExhausted) return;
      // Cursor = the id of the last-paged older entry (now history[0]), or null
      // to start from the newest. Nothing between here and a fetch advances it.
      const cursorId = history[0]?.submissionId ?? null;
      olderLoading = true;
      try {
         const row = await fetchOlderSubmission(
            supabase,
            currentSessionId,
            cursorId,
         );
         if (!row) {
            olderExhausted = true;
            return;
         }
         olderPrefetch = historyEntryFrom(row);
      } catch (e) {
         console.error("Failed to load previous problem:", e);
      } finally {
         olderLoading = false;
      }
   }

   // Step into the prefetched older problem: prepend it (it becomes the new
   // history[0], shifting this run's problems forward), show it, and warm the
   // next one further back.
   function consumeOlder() {
      const entry = olderPrefetch;
      if (!entry) return;
      olderPrefetch = null;
      history = [entry, ...history];
      restore(0);
      prefetchOlder();
   }

   // Forward steps through history; in practice, on the newest problem it acts as
   // Skip (abandon the current, unanswered problem and generate a new one). In a
   // test the set is fixed, so forward only ever steps within it.
   function goForward() {
      if (loading) return;
      if (isTest) {
         if (isLatest) return;
         commitCurrent();
         restore(historyIndex + 1);
         return;
      }
      if (isLatest) {
         if (submitted) return;
         recordSkip();
         loadProblem();
      } else {
         commitCurrent();
         restore(historyIndex + 1);
      }
   }

   function jumpToLatest() {
      if (loading || isLatest) return;
      commitCurrent();
      restore(history.length - 1);
   }

   function toggleFlag() {
      flagged = !flagged;
      if (currentAttemptIndex == null) return;

      attempts = attempts.map((attempt, i) =>
         i === currentAttemptIndex ? { ...attempt, flagged } : attempt,
      );
   }

   function togglePause() {
      if (!behavior.allowPause) return;
      if (!problem || submitted || loading || !isLatest) return;
      if (paused) {
         startedAt = Date.now() - frozenElapsedMs;
         paused = false;
      } else {
         frozenElapsedMs = liveElapsed();
         paused = true;
      }
   }

   // Resolve the session from the URL (the "root" alias maps to the always-
   // present root session), hydrate its settings + carried-over totals, warm the
   // Back button, then resume the in-progress problem or draw a fresh one.
   // Settings are intentionally *not* a reactive dependency of loadProblem: the
   // panel applies them to the next generated problem (via currentSettings()), so
   // tweaking a control must not fire a reload per change.
   onMount(async () => {
      try {
         const list = await fetchAllSeries(supabase);
         seriesOptions = list.map((s) => ({
            value: String(s.id),
            label: s.name,
         }));
      } catch (e) {
         console.error("Failed to fetch series options:", e);
      }

      // Signed-out: no session row and no persistence anywhere (root or a
      // deep-linked session RLS won't reveal). Draw a fresh problem ephemerally.
      if (!user) {
         loadProblem();
         return;
      }

      // Baseline for the live rating-delta chip; no await — it renders
      // whenever it lands.
      const seq = ++playerRatingSeq;
      fetchPlayerRating(supabase, user.id)
         .then((r) => {
            if (seq === playerRatingSeq) playerRating = r;
         })
         .catch((e) => console.error("Failed to fetch player rating:", e));

      try {
         const s = isRoot
            ? await getOrCreateRootSession(supabase, user.id)
            : await fetchSession(supabase, Number(sessionParam));
         if (s) {
            activeSession = s;
            applySettings(s.settings as unknown as PracticeSettings);
            // Baseline so the first load doesn't re-persist the snapshot.
            lastPersistedSettings = JSON.stringify(currentSettings());

            // Test format has its own setup (whole problem set up front,
            // deferred grading, results on completion) — don't fall through
            // to the random/review practice loop.
            if (format === "test") {
               await initTest(s);
               return;
            }

            // Seed the session totals from the trigger-maintained counters.
            // Under lazy back-paging the full history isn't loaded, so the
            // indicators carry over from these stored aggregates instead of a
            // client-side count. (times_reviewed counts graded attempts, so
            // incorrect = reviewed − correct.)
            priorCorrect = s.times_correct;
            priorIncorrect = s.times_reviewed - s.times_correct;
            priorSkipped = s.times_skipped;
            priorElapsedMs = s.total_time_ms;
            sessionAttemptCount = s.times_seen;

            // Seed the draw-state (problem ids only) so the queue doesn't
            // re-show a problem already covered this session, without
            // materializing the full history.
            try {
               const ids = await fetchSessionProblemIds(supabase, s.id);
               for (const id of ids) session.shownIds.add(id);
               session.drawIndex = ids.length;
            } catch (e) {
               console.error("Failed to seed session draw-state:", e);
            }

            // Warm the Back button (prefetch the previous problem).
            prefetchOlder();

            // Resume the in-progress problem instead of generating a new one,
            // continuing its elapsed timer where it left off.
            if (s.current_problem_id != null) {
               const pending = await fetchProblemById(s.current_problem_id);
               if (pending) {
                  showProblem(
                     pending,
                     "practice",
                     null,
                     s.current_elapsed_ms ?? 0,
                  );
                  return;
               }
            }
         }
      } catch (e) {
         error = (e as Error).message;
      }
      loadProblem();
   });

   $effect(() => {
      if (!timerRunning) return;

      const timer = setInterval(() => {
         timerNow = Date.now();
      }, 250);

      return () => clearInterval(timer);
   });

   // While a problem is in progress within a (practice) session, periodically
   // persist its elapsed time so a reload/resume continues from where it was.
   $effect(() => {
      if (isTest || !timerRunning) return;
      const sid = currentSessionId;
      if (sid == null) return;
      const pid = problem!.id;

      const timer = setInterval(() => {
         setCurrentProblem(supabase, sid, pid, liveElapsed()).catch((e) =>
            console.error("Failed to persist session progress:", e),
         );
      }, 5000);

      return () => clearInterval(timer);
   });

   // Test format: persist draft answers/time to localStorage — immediately when
   // the answer or position changes, and on a 5s heartbeat so elapsed time keeps
   // pace. Cleared on submit.
   $effect(() => {
      if (!isTest || testFinished || currentSessionId == null) return;
      // Track the inputs we want to snapshot on change.
      void selectedChoice;
      void answer;
      void flagged;
      void historyIndex;
      void history.length;
      // Debounce so rapid changes (e.g. typing a free-response answer) coalesce
      // into one localStorage write instead of stringifying history per
      // keystroke. The 5s heartbeat below bounds any data loss.
      const timer = setTimeout(writeTestDraft, 400);
      return () => clearTimeout(timer);
   });

   $effect(() => {
      if (!isTest || testFinished || currentSessionId == null) return;
      const timer = setInterval(() => writeTestDraft(), 5000);
      return () => clearInterval(timer);
   });

   // Auto-submit a timed test the moment the clock runs out.
   $effect(() => {
      if (!isTest || testFinished || submittingTest) return;
      if (timeLimitSeconds != null && remainingMs === 0) {
         submitTest();
      }
   });
</script>

{#snippet statChip(value: number, color: string)}
   <span
      class="inline-flex h-8 min-w-8 items-center justify-center rounded-md bg-surface-container-low px-2.5 font-mono tabular-nums"
      style:color
   >
      {value}
   </span>
{/snippet}

{#snippet testResults()}
   <div class="flex-1 overflow-y-auto px-4 sm:px-6 pb-10">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-4">
         <!-- Score summary -->
         <div
            class="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface-container-lowest p-5"
         >
            <div class="flex items-center gap-2">
               <Icon name="task_alt" class="text-primary" fontsize={22} />
               <h2 class="text-lg font-semibold">Test complete</h2>
            </div>
            <div
               class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground"
            >
               {@render statChip(testCorrect, "var(--color-correct)")}
               {@render statChip(testIncorrect, "var(--color-destructive)")}
               {@render statChip(testSkipped, "var(--color-unsure)")}
               <span class="ml-1">
                  {testCorrect}/{history.length} correct · {formatElapsed(
                     testElapsedTotalMs,
                  )}
               </span>
            </div>
            <SegmentBar
               class="h-2 min-w-0"
               segments={[
                  {
                     value: testCorrect,
                     color: "var(--color-correct)",
                     label: "Correct",
                  },
                  {
                     value: testIncorrect,
                     color: "var(--color-destructive)",
                     label: "Incorrect",
                  },
                  {
                     value: testSkipped,
                     color: "var(--color-unsure)",
                     label: "Skipped",
                  },
               ]}
            />
         </div>

         <!-- Per-problem review -->
         <div class="flex flex-col gap-3">
            {#each history as entry (entry.problem.id)}
               <ProblemReview {entry} />
            {/each}
         </div>

         <div class="flex justify-center pt-2">
            <Button variant="outline" href="/practice">Back to sessions</Button>
         </div>
      </div>
   </div>
{/snippet}

<div class="flex h-full w-full flex-col gap-0 overflow-hidden">
   <TopbarRegister left={topbarLeft} right={topbarRight} />
   {#snippet topbarLeft()}
      <div class="flex items-center gap-2 flex-1 min-w-0">
         <a
            href="/practice"
            class="inline-flex items-center rounded-md h-8 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Back to sessions"
         >
            <Icon name="arrow_back" class={iconCls} />
         </a>

         <Button
            variant="ghost"
            size="sm"
            class={cn(
               "text-muted-foreground hover:text-foreground text-xs font-normal gap-1.5 px-2.5 shrink-0",
               showSettings && "bg-muted text-foreground",
            )}
            onclick={() => (showSettings = !showSettings)}
            aria-expanded={showSettings}
            aria-label="Toggle settings"
         >
            <Icon name="tune" class={iconCls} />
         </Button>

         {#if activeSession && (activeSession.name || isTest)}
            <div class="flex flex-row items-center gap-1.5 shrink-0">
               {#if isTest}
                  <span
                     class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary"
                  >
                     <Icon name="quiz" class="size-[1em]" />
                     Test
                  </span>
               {/if}
               <span class="opacity-50 text-xs truncate max-w-24 sm:max-w-40"
                  >{activeSession.name}</span
               >
            </div>
         {/if}

         {#if playerRating}
            {@const tierSize = 200}
            {@const lower =
               Math.floor(playerRating.rating / tierSize) * tierSize}
            {@const upper = lower + tierSize}
            <div
               class="flex items-center text-xs text-muted-foreground/50 gap-1.5 min-w-0 flex-1"
            >
               <RatingCounter
                  value={playerRating.rating}
                  class="text-foreground font-medium"
               />
               <RatingLifeBar
                  bind:this={ratingBar}
                  {playerRating}
                  {tierSize}
                  class="h-2 w-full min-w-0"
               />
            </div>
         {/if}
      </div>
   {/snippet}

   {#snippet topbarRight()}
      <div class="flex items-center gap-2 min-w-0 flex-1">
         {#if behavior.showLiveFeedback && !focusModeActive}
            <SegmentBar
               class="min-w-15 w-full h-2"
               segments={[
                  {
                     value: correctAttempts,
                     color: "var(--color-correct)",
                     label: "Solved",
                  },
                  {
                     value: incorrectAttempts,
                     color: "var(--color-destructive)",
                     label: "Incorrect",
                  },
                  {
                     value: skippedAttempts,
                     color: "var(--color-unsure)",
                     label: "Skipped",
                  },
               ]}
            />
         {/if}
         {#if isTest}
            {#if !testFinished && history.length > 0}
               {@const timed = timeLimitSeconds != null}
               {@const low =
                  timed && remainingMs != null && remainingMs <= 60_000}
               {@const displayMs = timed ? (remainingMs ?? 0) : totalElapsedMs}
               <div
                  class={cn(
                     "inline-flex h-8 items-center justify-center rounded-md",
                     focusModeActive ? "w-8 px-0" : "gap-1.5 px-2.5",
                     low
                        ? "bg-destructive/15 text-destructive"
                        : "bg-surface-container-low",
                  )}
                  title={`${timed ? "Time remaining" : "Elapsed time"}: ${formatElapsed(displayMs)}`}
                  aria-label={timed ? "Time remaining" : "Elapsed time"}
               >
                  {#if !focusModeActive}
                     <Icon
                        name={timed ? "timer" : "schedule"}
                        class={iconCls}
                     />
                  {/if}
                  <span
                     class={cn(
                        "leading-none tabular-nums font-mono",
                        !focusModeActive && "min-w-[5ch] text-center",
                     )}
                  >
                     {formatElapsed(displayMs)}
                  </span>
               </div>
            {/if}
         {:else if problem || loading}
            {@const isTotal = timerMode === "total"}
            {@const displayMs = isTotal ? totalElapsedMs : elapsedMs}
            <div class="flex items-center gap-1.5">
               <!-- Pause is only actionable on the latest unanswered problem,
                         but its footprint is reserved whenever the session allows
                         pausing so submitting/navigating never changes the topbar
                         width (which would otherwise reflow the rating bar). -->
               {#if behavior.allowPause}
                  <div class="size-8 shrink-0">
                     {#if !submitted && isLatest}
                        <Button
                           variant="ghost"
                           size="icon-sm"
                           class="text-muted-foreground hover:text-foreground"
                           onclick={togglePause}
                           aria-label={paused
                              ? "Resume practice"
                              : "Pause practice"}
                           title={paused ? "Resume" : "Pause"}
                        >
                           <Icon
                              name={paused ? "play_arrow" : "pause"}
                              class={iconCls}
                           />
                        </Button>
                     {/if}
                  </div>
               {/if}
               <button
                  type="button"
                  onclick={() => (timerMode = isTotal ? "problem" : "total")}
                  class={cn(
                     "inline-flex h-8 items-center justify-center rounded-md bg-surface-container-low transition-colors hover:bg-surface-container",
                     focusModeActive ? "w-8 px-0" : "gap-1 px-2.5",
                  )}
                  title={isTotal
                     ? `Total session time: ${formatElapsed(displayMs)} — click for this problem`
                     : `Time on this problem: ${formatElapsed(displayMs)} — click for session total`}
                  aria-label={isTotal
                     ? "Total session time"
                     : "Time on this problem"}
               >
                  {#if !focusModeActive}
                     <Icon
                        name={isTotal ? "timelapse" : "schedule"}
                        class={iconCls}
                     />
                  {/if}

                  <span
                     class={cn(
                        "leading-none tabular-nums font-mono",
                        !focusModeActive && "min-w-[5ch] text-center",
                     )}
                  >
                     {formatElapsed(displayMs)}
                  </span>
               </button>
            </div>
         {/if}
      </div>
   {/snippet}

   <!-- Main Content Area: Problem + Collapsible Settings Panel -->
   <div
      class="flex flex-1 flex-col lg:flex-row gap-0 items-stretch justify-center w-full min-h-0"
   >
      <main
         class="flex-1 w-full min-w-0 flex flex-col justify-between pt-0 min-h-0 overflow-visible"
      >
         {#if loading}
            <div
               class="flex-1 flex flex-col items-center justify-center gap-3 text-center"
            >
               <Icon
                  name="progress_activity"
                  class="animate-spin text-muted-foreground"
                  fontsize={24}
               />
               <p class="text-xs text-muted-foreground">
                  {isTest ? "Loading test..." : "Generating problem..."}
               </p>
            </div>
         {:else if error}
            <div
               class="flex-1 flex flex-col items-center justify-center gap-4 text-center"
            >
               <div
                  class="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"
               >
                  <Icon name="error" fontsize={20} />
               </div>
               <div class="flex max-w-4xl flex-col gap-1">
                  <h2 class="text-sm font-semibold">
                     {isTest
                        ? "Could not load the test"
                        : "Could not load a problem"}
                  </h2>
                  <p class="text-xs text-muted-foreground">{error}</p>
               </div>
               {#if isTest}
                  <Button size="sm" onclick={() => window.location.reload()}
                     >Retry</Button
                  >
               {:else}
                  <Button size="sm" onclick={() => loadProblem()}>Retry</Button>
               {/if}
            </div>
         {:else if isTest && testFinished}
            {@render testResults()}
         {:else if isTest && history.length === 0}
            <div
               class="flex-1 flex flex-col items-center justify-center gap-4 text-center"
            >
               <div
                  class="flex size-10 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
               >
                  <Icon name="quiz" fontsize={20} />
               </div>
               <div class="flex max-w-sm flex-col gap-1">
                  <h2 class="text-sm font-semibold">
                     This test has no answerable problems
                  </h2>
                  <p class="text-xs text-muted-foreground">
                     None of its problems have a statement and choices yet.
                  </p>
               </div>
               <Button size="sm" variant="outline" href="/practice">
                  Back to sessions
               </Button>
            </div>
         {:else if !problem}
            <div
               class="flex-1 flex flex-col items-center justify-center gap-4 text-center"
            >
               <div
                  class="flex size-10 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
               >
                  <Icon name="filter_alt_off" fontsize={20} />
               </div>
               <div class="flex max-w-sm flex-col gap-1">
                  <h2 class="text-sm font-semibold">No matching problems</h2>
                  <p class="text-xs text-muted-foreground">
                     {#if mode === "skipped"}
                        You've gone through every unsolved skipped problem that
                        matches these settings. Reset to cycle through them
                        again, or broaden the settings.
                     {:else if mode === "review" || mode === "mixed"}
                        You've gone through everything queued this session.
                        Reset to cycle through them again, or broaden the
                        settings.
                     {:else}
                        Try broadening the settings, then generate again.
                     {/if}
                  </p>
               </div>
               <div class="flex items-center gap-2">
                  {#if mode === "review" || mode === "skipped" || mode === "mixed"}
                     <Button size="sm" onclick={resetSession} class="gap-1.5">
                        <Icon name="restart_alt" />
                        {mode === "skipped"
                           ? "Reset skipped queue"
                           : "Reset review queue"}
                     </Button>
                  {/if}
                  <Button
                     variant="outline"
                     size="sm"
                     onclick={() => loadProblem()}
                  >
                     Try again
                  </Button>
               </div>
            </div>
         {:else}
            <div class="mx-auto flex min-h-0 w-full flex-1 flex-col">
               <div class="relative flex-1 flex flex-col min-h-0 w-full">
                  <!-- Problem statement and choices: Scrollable area -->
                  <div
                     class="flex-1 flex flex-col justify-start items-center gap-4 w-full min-h-0 overflow-y-auto pt-0 pb-4 px-6"
                  >
                     <!-- Metadata row: source/series/topic on the left, review status on the right -->
                     <MetadataBar
                        {problem}
                        {problemRating}
                        {hasAnswer}
                        showLiveFeedback={behavior.showLiveFeedback}
                        {focusModeActive}
                        {currentSource}
                        {currentProgress}
                        {isTest}
                        {historyIndex}
                        historyLength={history.length}
                        revealLinks={submitted}
                        onOpenAnswerSubmission={openAnswerSubmission}
                     />

                     {#if debugMode && !focusModeActive}
                        <DebugInfo
                           {problem}
                           {playerRating}
                           {problemRating}
                           bind:showRawLatex
                           onClose={() => (debugMode = false)}
                        />
                     {/if}

                     <div
                        class={cn(
                           "flex min-h-fit w-full",
                           solutionShown
                              ? "flex-none items-start justify-start"
                              : "flex-1 items-center justify-center",
                        )}
                     >
                        {#if debugMode && showRawLatex && !focusModeActive}
                           <pre
                              class="font-mono text-sm text-foreground leading-relaxed text-left w-full max-w-4xl py-4 bg-surface-container/50 px-4 rounded-lg overflow-x-auto whitespace-pre-wrap break-words border border-border/80">
                                            {problem.statement ?? ""}
                                        </pre>
                        {:else}
                           <MathStatement
                              text={formatProblemText(
                                 problem.statement ?? "",
                                 isProblemMcq,
                              )}
                              class="font-serif text-lg md:text-xl text-foreground leading-relaxed text-left w-full max-w-4xl py-2"
                           />
                        {/if}
                     </div>
                     <div class="w-full">
                        <ProblemAnswer
                           bind:this={answerFeedback}
                           choices={problem.choices}
                           answerIndex={problem.answer_index}
                           bind:answer
                           bind:selectedChoice
                           bind:eliminated={eliminatedChoices}
                           showAnswerState={behavior.revealAnswerState &&
                              submitted &&
                              hasAnswer}
                           disabled={behavior.freezeOnNavigate
                              ? submitted || !isLatest || paused
                              : false}
                           onEnter={behavior.gradeImmediately
                              ? submitAnswer
                              : undefined}
                        />
                     </div>

                     <!-- Official worked solutions, revealed once the problem
                                 is finalized. Auto-opens on a wrong answer; keyed per
                                 problem so its open/selection state re-seeds. -->
                     {#if solutionShown}
                        {#key problem.id}
                           <ProblemSolution
                              class="w-full"
                              solutions={problem.official_solutions}
                              defaultOpen={correct === false}
                           />
                        {/key}
                     {/if}
                  </div>

                  {#if paused}
                     <PauseOverlay
                        {elapsedMs}
                        {totalElapsedMs}
                        {timerMode}
                        {correctAttempts}
                        {incorrectAttempts}
                        {skippedAttempts}
                        canEndSession={!!activeSession && !isRoot}
                        endingSession={sessionBusy}
                        onResume={togglePause}
                        onOpenSettings={() => (showSettings = true)}
                        onEndSession={finishSession}
                        onToggleTimerMode={() =>
                           (timerMode =
                              timerMode === "total" ? "problem" : "total")}
                     />
                  {/if}
               </div>

               <!-- Footer with ghosted Flag/Skip and primary Next/Submit buttons -->
               <footer
                  class="sticky bottom-0 z-30 flex w-full items-center justify-between border-t border-border/50 bg-background/80 px-2 py-1"
               >
                  <div
                     class="absolute inset-0 -z-10 bg-background/80 backdrop-blur-(--backdrop-blur) pointer-events-none"
                  ></div>
                  {#if focusModeActive}
                     <div class="flex items-center gap-1">
                        {#if canGoBack}
                           <Button
                              variant="ghost"
                              disabled={behavior.gradeImmediately && paused}
                              onclick={goBack}
                              aria-label="Previous problem"
                              class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto [&_svg]:size-3.5 disabled:opacity-30"
                           >
                              <Icon name="arrow_back" />
                           </Button>
                        {/if}
                        <DropdownMenu options={moreOptions}>
                           <Button
                              variant="ghost"
                              aria-label="More options"
                              class={cn(
                                 "font-normal text-xs px-2.5 py-1.5 h-auto [&_svg]:size-3.5",
                                 flagged
                                    ? "text-unsure hover:text-unsure/80"
                                    : "text-muted-foreground hover:text-foreground",
                              )}
                           >
                              <Icon name="more_horiz" />
                           </Button>
                        </DropdownMenu>
                     </div>

                     <div class="flex items-center gap-2">
                        {#if !behavior.gradeImmediately}
                           {#if !isLatest}
                              <Button
                                 variant="ghost"
                                 onclick={goForward}
                                 aria-label="Next problem"
                                 class="text-muted-foreground hover:text-foreground font-normal text-xs px-2.5 py-1.5 h-auto gap-1 [&_svg]:size-3.5"
                              >
                                 <Icon name="arrow_forward" />
                              </Button>
                           {:else}
                              <Button
                                 onclick={submitTest}
                                 disabled={submittingTest}
                                 class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
                              >
                                 <Icon name="done_all" />
                                 Submit test
                              </Button>
                           {/if}
                        {:else if !isLatest}
                           <Button
                              variant="outline"
                              onclick={jumpToLatest}
                              disabled={paused}
                              class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                           >
                              Latest
                              <Icon name="last_page" />
                           </Button>
                        {:else if submitted}
                           <Button
                              onclick={() => loadProblem()}
                              class="bg-primary/90 text-primary-foreground hover:bg-primary text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
                           >
                              Next
                              <Icon name="arrow_forward" />
                           </Button>
                        {:else}
                           <Button
                              variant="ghost"
                              disabled={paused}
                              onclick={goForward}
                              class="text-muted-foreground hover:text-foreground text-xs font-semibold px-3 py-2 h-9 gap-1.5 rounded-lg disabled:opacity-30"
                           >
                              <Icon name="skip_next" />
                              Skip
                           </Button>
                           <Button
                              disabled={cannotSubmit}
                              onclick={submitAnswer}
                              class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 shadow-sm rounded-lg"
                           >
                              Submit
                           </Button>
                        {/if}
                     </div>
                  {:else if !behavior.gradeImmediately}
                     <div class="flex items-center gap-1">
                        <Button
                           variant="ghost"
                           disabled={!canGoBack}
                           onclick={goBack}
                           aria-label="Previous problem"
                           class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto [&_svg]:size-3.5 disabled:opacity-30"
                        >
                           <Icon name="arrow_back" />
                        </Button>
                        <DropdownMenu options={moreOptions}>
                           <Button
                              variant="ghost"
                              aria-label="More options"
                              class={cn(
                                 "font-normal text-xs px-2.5 py-1.5 h-auto [&_svg]:size-3.5",
                                 flagged
                                    ? "text-unsure hover:text-unsure/80"
                                    : "text-muted-foreground hover:text-foreground",
                              )}
                           >
                              <Icon name="more_horiz" />
                           </Button>
                        </DropdownMenu>
                     </div>

                     <div>
                        {#if !isLatest}
                           <Button
                              variant="ghost"
                              onclick={goForward}
                              aria-label="Next problem"
                              class="text-muted-foreground hover:text-foreground font-normal text-xs px-2.5 py-1.5 h-auto gap-1 [&_svg]:size-3.5"
                           >
                              <Icon name="arrow_forward" />
                           </Button>
                        {:else}
                           <Button
                              onclick={submitTest}
                              disabled={submittingTest}
                              class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
                           >
                              <Icon name="done_all" />
                              Submit test
                           </Button>
                        {/if}
                     </div>
                  {:else}
                     <div class="flex items-center gap-1">
                        <Button
                           variant="ghost"
                           disabled={!canGoBack || paused}
                           onclick={goBack}
                           aria-label="Previous problem"
                           class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto [&_svg]:size-3.5 disabled:opacity-30"
                        >
                           <Icon name="arrow_back" />
                        </Button>
                        <DropdownMenu options={moreOptions}>
                           <Button
                              variant="ghost"
                              aria-label="More options"
                              class={cn(
                                 "font-normal text-xs px-2.5 py-1.5 h-auto [&_svg]:size-3.5",
                                 flagged
                                    ? "text-unsure hover:text-unsure/80"
                                    : "text-muted-foreground hover:text-foreground",
                              )}
                           >
                              <Icon name="more_horiz" />
                           </Button>
                        </DropdownMenu>
                        <Button
                           variant="ghost"
                           disabled={(isLatest && submitted) || paused}
                           onclick={goForward}
                           aria-label={isLatest
                              ? "Skip problem"
                              : "Next problem"}
                           class="text-muted-foreground hover:text-foreground font-normal text-xs px-2 py-1.5 h-auto gap-1 [&_svg]:size-3.5 disabled:opacity-30"
                        >
                           {#if isLatest}
                              <Icon name="skip_next" />
                              Skip
                           {:else}
                              <Icon name="arrow_forward" />
                           {/if}
                        </Button>
                     </div>

                     <div class="flex items-center gap-2">
                        {#if isLatest && !submitted && hasAnswer && triesUsed > 0 && triesPerProblem > 1}
                           <span
                              class="text-[11px] text-muted-foreground tabular-nums"
                              title="Attempts remaining on this problem"
                           >
                              {triesRemaining}
                              {triesRemaining === 1 ? "try" : "tries"} left
                           </span>
                        {/if}
                        {#if !isLatest}
                           <Button
                              variant="outline"
                              onclick={jumpToLatest}
                              disabled={paused}
                              class="text-xs font-semibold px-4 py-2 h-9 gap-1.5 rounded-lg"
                           >
                              Latest
                              <Icon name="last_page" />
                           </Button>
                        {:else if submitted}
                           {#if playerRating && ratingDelta !== null}
                              <span
                                 transition:fade={{ duration: 150 }}
                                 class={cn(
                                    "text-[11px] font-semibold tabular-nums",
                                    ratingDelta > 0.5
                                       ? "text-correct"
                                       : ratingDelta < -0.5
                                         ? "text-destructive"
                                         : "text-muted-foreground",
                                 )}
                                 title="Your skill rating (change from this problem)"
                              >
                                 {Math.round(playerRating.rating)}
                                 <span class="font-normal">
                                    ({ratingDelta >= 0 ? "+" : ""}{Math.round(
                                       ratingDelta,
                                    )})
                                 </span>
                              </span>
                           {/if}
                           <Button
                              onclick={() => loadProblem()}
                              class="bg-primary/90 text-primary-foreground hover:bg-primary text-xs font-semibold px-4 py-2 h-9 gap-1.5 shadow-sm rounded-lg"
                           >
                              Next
                              <Icon name="arrow_forward" />
                           </Button>
                        {:else}
                           <Button
                              disabled={cannotSubmit}
                              onclick={submitAnswer}
                              class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 shadow-sm rounded-lg"
                           >
                              Submit
                           </Button>
                        {/if}
                     </div>
                  {/if}
               </footer>
            </div>
         {/if}
      </main>

      <!-- Sidebar settings panel -->
      {#if showSettings}
         <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
         <div
            class="fixed inset-0 z-40 bg-black/40 backdrop-blur-(--backdrop-blur) lg:hidden"
            onclick={() => (showSettings = false)}
            transition:fade={{ duration: 150 }}
         ></div>
         <SettingsPanel
            bind:mode
            bind:topic
            bind:difficulty
            bind:verifiedOnly
            bind:computational
            bind:answerAvailability
            bind:solutionAvailability
            bind:triesPerProblem
            bind:seriesIds
            {seriesOptions}
            {counterRanges}
            {counterEnabled}
            bind:lastSubmissionDays
            bind:lastOutcome
            bind:includeUnscheduled
            bind:adaptive
            bind:adaptiveRange
            bind:focusMode
            canReview={!!user}
            {isTest}
            {testName}
            {timeLimitSeconds}
            onFocusModeChange={setFocusMode}
            onClose={() => (showSettings = false)}
         />
      {/if}
   </div>
</div>
