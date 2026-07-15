<script lang="ts">
   import type { PageData } from "./$types";
   import { goto } from "$app/navigation";
   import { resolve } from "$app/paths";
   import { Button } from "$lib/components/button";
   import { Icon } from "$lib/components/icon";
   import type { DropdownOption } from "$lib/components/dropdown-menu";
   import { MathStatement } from "$lib/components/math-statement";
   import { ProblemAnswer, ProblemSolution } from "$lib/components/problem";
   import { ProblemOrganization } from "$lib/components/problem-organization";
   import { Modal } from "$lib/components/modal";
   import { ProblemGrid, type ProblemGridCell } from "$lib/components/problem-grid";
   import DebugInfo from "./DebugInfo.svelte";
   import {
      topicLabel,
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
      createSession,
      fetchTestProblems,
      FORMAT_BEHAVIOR,
      nextPracticeProblem,
      type PracticeAttempt,
      type PracticeSettings,
      type PracticeSource,
      type ProblemProgress,
   } from "$lib/trainer";
   import {
      dimensionOptions,
      fetchSeriesDimensions,
      type SeriesDimensionRow,
   } from "$lib/series-review";
   import { recordSubmission, setProblemMastery, type Mastery } from "$lib/progress";
   import { countdownRemainingMs } from "$lib/countdown";
   import {
      isLastSegment,
      segmentCount,
      segmentElapsedMs,
      segmentRange,
   } from "$lib/segment-timing";
   import { Countdown } from "$lib/components/countdown";
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
   } from "$lib/sessions";
   import { cn, formatProblemText } from "$lib/utils";
   import { answersMatch, normalizeAnswer } from "$lib/utils/answer-matcher";
   import { modal } from "$lib/state/modal.svelte";
   import { toasts } from "$lib/state/toast.svelte";
   import AnswerSubmissionModal from "./AnswerSubmissionModal.svelte";
   import { onMount } from "svelte";
   import { fade } from "svelte/transition";
   import SettingsPanel from "./SettingsPanel.svelte";
   import PauseOverlay from "./PauseOverlay.svelte";
   import MetadataBar from "./MetadataBar.svelte";
   import PracticeTopbar, {
      type RatingBarHandle,
   } from "./PracticeTopbar.svelte";
   import PracticeFooter from "./PracticeFooter.svelte";
   import TestResults from "./TestResults.svelte";
   import {
      commitPracticeHistoryEntry,
      createPracticeAnswerState,
      createPracticeHistoryEntry,
      practiceHistoryEntryFromSubmission,
      restorePracticeAnswerState,
      type PracticeAnswerState,
      type PracticeHistoryEntry,
   } from "./practice-state";
   import {
      createPracticeSettingsForm,
      practiceSettingsFromForm,
      type PracticeSettingsForm,
      type SeriesScopeConfig,
   } from "./practice-settings";
   import {
      applyTestOutcome,
      clearTestDraft as clearStoredTestDraft,
      createTestDraft,
      loadTestDraft as loadStoredTestDraft,
      restoreTestDraft,
      summarizeTestResults,
      writeTestDraft as writeStoredTestDraft,
   } from "./test-state";

   // `sessionParam` is the `?session=` value: "root" (ungrouped work) or a
   // numeric session id. The parent route keys this component on it, so a
   // session switch fully remounts and resets all practice state.
   let { data, sessionParam }: { data: PageData; sessionParam: string } =
      $props();
   let { supabase, user } = $derived(data);

   let settingsForm = $state<PracticeSettingsForm>(
      createPracticeSettingsForm(),
   );
   let seriesOptions = $state<{ value: string; label: string }[]>([]);
   // One entry per *selected* series that carries division/format vocabulary, so
   // the settings panel can show a per-series division/format row (unclassified
   // series contribute none). Populated by the effect below.
   let seriesScopeConfigs = $state<SeriesScopeConfig[]>([]);
   let showSettings = $state(false);
   let paused = $state(false);

   // Session format. Resolved from the session's settings snapshot on mount and
   // then fixed for the life of the view ("practice" = the historical free-form
   // flow; "test" = work a whole test with deferred grading). Older snapshots
   // predate `format`, so a missing value is treated as "practice".
   let isTest = $derived(settingsForm.format === "test");
   // Per-format defaults, overlaid with the session's creation-time opt-ins. Only
   // `allowPause` is currently overridable: a test runs uninterrupted by default,
   // but the user can enable pausing when creating it. Everything else stays as the
   // format dictates.
   let behavior = $derived({
      ...FORMAT_BEHAVIOR[settingsForm.format],
      allowPause: isTest
         ? (settingsForm.allowPause ?? false)
         : FORMAT_BEHAVIOR[settingsForm.format].allowPause,
   });
   // Test lifecycle: true once the test has been submitted (or re-opened as an
   // already-ended test), which switches the view over to the results screen.
   let testFinished = $state(false);
   let focusModeActive = $derived(settingsForm.focusMode && !testFinished);
   let submittingTest = $state(false);

   // ---- Segmented Test pacing (MATHCOUNTS Target / Countdown) -----------------
   // A segmented test works its problems in fixed-size, independently-timed
   // segments (Target = pairs, Countdown = singles): time doesn't carry between
   // segments and you can't navigate back into a locked (earlier) one. Grading is
   // unchanged — a segment boundary only freezes the problems behind it; the whole
   // test is still graded once at the end via submitTest(). Pooled tests (a
   // `pooled`/absent pacing) keep the single-clock behavior untouched.
   let segmentSize = $derived(
      isTest && settingsForm.pacing?.kind === "segmented"
         ? settingsForm.pacing.segmentSize
         : 0,
   );
   let isSegmented = $derived(isTest && segmentSize > 0);
   // Countdown-only (single-problem segments): grade + reveal each problem's
   // outcome the instant its segment is submitted, instead of deferring every
   // reveal to the results screen. Final recording is still a single deferred
   // grade in submitTest(); this only surfaces the outcome early.
   let revealPerSegment = $derived(
      isSegmented && segmentSize === 1 && (settingsForm.revealPerSegment ?? false),
   );
   let secondsPerSegment = $derived(
      settingsForm.pacing?.kind === "segmented"
         ? settingsForm.pacing.secondsPerSegment
         : null,
   );
   // Strict (default) hard-locks + auto-advances a segment at 0:00; lenient lets
   // its clock run red and overrun until the user chooses to continue.
   let strictTiming = $derived(settingsForm.strictTiming ?? true);
   // The furthest-reached, still-active segment. Earlier segments are locked.
   let currentSegment = $state(0);
   // Countdown reveal: true once the current single-problem segment has been graded
   // and revealed in place, awaiting the user's "Next" to advance. Freezes the
   // segment clock and suppresses strict auto-advance until they continue.
   let segmentRevealed = $state(false);
   // The on-screen problem is currently showing its graded outcome (Countdown
   // reveal, mid-test). Drives answer-state reveal + input lock without touching
   // the format-wide behavior flags.
   let revealActive = $derived(revealPerSegment && segmentRevealed);
   // Between-segment card ("Pair N of M — starting"): freezes the new segment's
   // clock until dismissed (Start button for pairs, ~3s auto-flash for singles).
   let interstitial = $state<{ segment: number } | null>(null);
   let interstitialToken = 0;
   const INTERSTITIAL_FLASH_MS = 3000;

   // Progress-backed modes need per-user progress. Without a session, pin to New.
   $effect(() => {
      if (!user && settingsForm.mode !== "new") settingsForm.mode = "new";
   });

   // Division/format is a per-series narrowing (each series has its own
   // vocabulary), so for every selected series we fetch its dimensions and build
   // a scope row — but only for classified series (those with actual division or
   // format values). Fetched dimensions are cached across selection changes.
   let dimensionToken = 0;
   const dimensionCache = new Map<number, SeriesDimensionRow[]>();

   // Keep `settingsForm.seriesScopes` in step with the classified selection:
   // drop entries for deselected series (so stale tags never leak into the draw
   // or the persisted snapshot) and seed an empty entry for each classified one
   // so the panel's comboboxes have a bindable target.
   function reconcileScopes(classifiedIds: string[]) {
      const scopes = settingsForm.seriesScopes;
      const keep = new Set(classifiedIds);
      for (const key of Object.keys(scopes)) {
         if (!keep.has(key)) delete scopes[key];
      }
      for (const id of classifiedIds) {
         scopes[id] ??= { divisions: [], formats: [] };
      }
   }

   $effect(() => {
      const ids = [...settingsForm.seriesIds];
      const names = seriesOptions;
      const token = ++dimensionToken;

      void (async () => {
         const configs: SeriesScopeConfig[] = [];
         for (const idStr of ids) {
            const id = Number(idStr);
            if (!Number.isFinite(id)) continue;
            let rows = dimensionCache.get(id);
            if (!rows) {
               try {
                  rows = await fetchSeriesDimensions(supabase, id);
               } catch (e) {
                  console.error("Failed to fetch series dimensions:", e);
                  continue;
               }
               dimensionCache.set(id, rows);
            }
            const divisions = dimensionOptions(rows, "division");
            const formats = dimensionOptions(rows, "format");
            if (divisions.length === 0 && formats.length === 0) continue;
            configs.push({
               id: idStr,
               name: names.find((o) => o.value === idStr)?.label ?? `Series ${idStr}`,
               divisionOptions: divisions,
               formatOptions: formats,
            });
         }
         if (token !== dimensionToken) return;
         reconcileScopes(configs.map((c) => c.id));
         seriesScopeConfigs = configs;
      })();
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
      settingsForm = createPracticeSettingsForm(raw);
   }

   async function finishSession() {
      if (!activeSession || isRoot || sessionBusy) return;
      sessionBusy = true;
      try {
         await endSession(supabase, activeSession.id);
         await goto(resolve("/practice"));
      } catch (e) {
         error = (e as Error).message;
         sessionBusy = false;
      }
   }

   // ---- Test format ----------------------------------------------------------

   // Draft answers for an in-progress test live client-side (localStorage) until
   // the test is submitted: grading is deferred and submissions are append-only,
   // so there is nowhere server-side to stash unsubmitted answers.
   // Snapshot the current live answer + every history entry to localStorage.
   // Uses the live vars for the on-screen entry (not yet committed) so a reload
   // never loses the answer being worked on. Non-reactive; safe to call anywhere.
   function writeTestDraft() {
      if (currentSessionId == null) return;
      writeStoredTestDraft(
         localStorage,
         currentSessionId,
         createTestDraft(
            history,
            historyIndex,
            {
               ...answerState,
               elapsedMs: liveElapsed(),
            },
            currentSegment,
         ),
      );
   }

   // Build the test's problem set (or the results, if already submitted) into the
   // history model. Unlike practice, the whole ordered set is known up front and
   // every entry stays editable until the single final submission.
   async function initTest(s: PracticeSessionRow) {
      loading = true;
      try {
         if (settingsForm.testId == null) {
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
            history = ordered.map(practiceHistoryEntryFromSubmission);
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
         const problems = await fetchTestProblems(supabase, settingsForm.testId);
         history = problems.map((problem) =>
            createPracticeHistoryEntry({
               problem,
               source: "practice",
               progress: null,
            }),
         );

         // Restore any in-progress draft (answers + per-problem time + place).
         const draft = loadStoredTestDraft(localStorage, s.id);

         if (history.length > 0) {
            const place = restoreTestDraft(history, draft);
            if (isSegmented) {
               // Never resume into an already-locked segment: clamp the current
               // segment and land on a problem within it (its start if the saved
               // spot fell outside).
               const maxSeg = Math.max(
                  0,
                  segmentCount(history.length, segmentSize) - 1,
               );
               currentSegment = Math.min(place.segmentIndex, maxSeg);
               const [segStart, segEnd] = segmentRange(
                  currentSegment,
                  segmentSize,
                  history.length,
               );
               restore(
                  place.historyIndex >= segStart && place.historyIndex < segEnd
                     ? place.historyIndex
                     : segStart,
               );
            } else {
               restore(place.historyIndex);
            }
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
               const outcome = applyTestOutcome(e);
               return {
                  user_id: user.id,
                  problem_id: e.problem.id,
                  selected_choice: e.selectedChoice,
                  // Persist the free-text response (non-MCQ) so the grade stays
                  // auditable/re-gradable; null for MCQ/blank.
                  answer: e.answer.trim() ? e.answer : null,
                  is_correct: outcome.correct,
                  skipped: outcome.skipped,
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
            // Auto-assign the suggested mastery for every attempted problem the
            // user never rated (skips carry no knowledge signal, so they're left
            // alone). Mirrors the trainer's leave-behavior; fire-and-forget.
            for (const e of history) {
               if (e.skipped || e.progress?.mastery) continue;
               const m: Mastery = e.correct ? "confident" : "needs_work";
               setProblemMastery(supabase, e.problem.id, m).catch((err) =>
                  console.error("Failed to auto-assign mastery:", err),
               );
            }
            // Grades are in, so the local draft is obsolete — drop it now, not
            // after endSession, so a failed end can't strand stale answers
            // that a resubmit would silently discard.
            clearStoredTestDraft(localStorage, currentSessionId);
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

   // Segmented pacing: lock the current segment and move to the next. On the last
   // segment this is the end of the test → grade via submitTest(). No grading
   // happens here otherwise — the just-left segment's problems are simply frozen
   // (they stay in `history`, editable-looking but unreachable via nav).
   function advanceSegment() {
      if (!isSegmented || testFinished || submittingTest) return;
      // Countdown reveal: the first activation grades + reveals this problem in
      // place; the actual advance waits for the user to continue past the result.
      if (revealPerSegment && !segmentRevealed) {
         revealCurrentSegment();
         return;
      }
      segmentRevealed = false;
      if (onLastSegment) {
         submitTest();
         return;
      }
      commitCurrent();
      const next = currentSegment + 1;
      currentSegment = next;
      const [start] = segmentRange(next, segmentSize, history.length);
      startInterstitial(next, start);
   }

   // Countdown reveal: grade the current single-problem segment locally and show
   // its outcome in place (answer state + solution), freezing the clock until the
   // user continues. Final grading is still deferred to submitTest(), which
   // recomputes every outcome from the stored answer — so this early reveal never
   // changes the recorded result.
   function revealCurrentSegment() {
      if (!problem) return;
      answerState.elapsedMs = liveElapsed();
      commitCurrent();
      const entry = history[historyIndex];
      if (entry) {
         applyTestOutcome(entry);
         answerState.submitted = true;
         answerState.correct = entry.correct;
      }
      segmentRevealed = true;
   }

   // Show the between-segment card and land (frozen) on the new segment's first
   // problem. Single-problem segments (Countdown) get a brief auto-dismissing
   // flash instead of a card the user must click through.
   function startInterstitial(segment: number, firstIndex: number) {
      restore(firstIndex);
      interstitial = { segment };
      if (segmentSize === 1) {
         const token = ++interstitialToken;
         setTimeout(() => {
            if (token === interstitialToken) dismissInterstitial();
         }, INTERSTITIAL_FLASH_MS);
      }
   }

   // Dismiss the interstitial and resume the new segment's clock from where the
   // (fresh) entry left off, so the frozen interval isn't counted against it.
   function dismissInterstitial() {
      if (!interstitial) return;
      interstitialToken += 1;
      interstitial = null;
      const now = Date.now();
      startedAt = now - answerState.elapsedMs;
      timerNow = now;
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
         createPracticeHistoryEntry({
            problem: p,
            source,
            progress,
            elapsedMs,
         }),
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
   let history = $state<PracticeHistoryEntry[]>([]);
   let historyIndex = $state(-1);

   // Root ("practice freely") lazy back-paging. `olderPrefetch` holds the single
   // problem immediately older than history[0], fetched ahead so Back's
   // enabled-state is known and stepping back is instant; its `submissionId` is
   // the cursor for paging further back. `olderExhausted` marks the start of
   // history reached.
   let olderPrefetch = $state<PracticeHistoryEntry | null>(null);
   let olderExhausted = $state(false);
   let olderLoading = $state(false);

   let problem = $state<ProblemRow | null>(null);
   let debugMode = $state(false);
   let showRawLatex = $state(false);
   let loading = $state(true);
   let error = $state<string | null>(null);
   let answerState = $state<PracticeAnswerState>(createPracticeAnswerState());
   // Whether the user made any explicit mastery choice for the on-screen problem
   // (including deliberately clearing it to "Unassessed"). Reset per problem in
   // restore()/loadProblem(). When false on leave, the suggested mastery is
   // auto-applied so a graded problem doesn't linger unassessed.
   let masteryTouched = $state(false);
   // The mastery we recommend for the just-graded problem: correct-first-try →
   // confident, correct-with-retries → learning, wrong → needs work. Also fed to
   // the ProblemOrganization prompt so the emphasized suggestion and the
   // auto-applied value are always the same.
   let suggestedMastery = $derived<Mastery>(
      answerState.correct
         ? answerState.triesUsed > 0
            ? "learning"
            : "confident"
         : "needs_work",
   );
   // Once a finalized problem has solutions to show, the statement/answer collapse
   // to their natural height (no vertical fill) so the solution panel gets the rest.
   let solutionShown = $derived(
      answerState.submitted && (problem?.official_solutions?.length ?? 0) > 0,
   );
   let startedAt = $state(Date.now());
   let timerNow = $state(Date.now());
   let attempts = $state<PracticeAttempt[]>([]);

   // Multi-try practice: how many attempts are allowed per problem, how many
   // have been spent on the on-screen problem, and the (in-memory) set of
   // answers already tried for it. Re-submitting a tried answer is rejected and
   // does not consume a try. Reset per problem; carried on the history entry so
   // back/forward navigation preserves the count.
   // Component ref for the answer UI, so a wrong-but-not-final attempt can flash
   // the shake/feedback animation without revealing the correct answer.
   let answerFeedback = $state<ProblemAnswer | null>(null);
   let triesRemaining = $derived(
      Math.max(0, settingsForm.triesPerProblem - answerState.triesUsed),
   );

   let loadToken = 0;

   let isLatest = $derived(historyIndex === history.length - 1);

   // Segmented pacing geometry. `segBounds` is the current segment's half-open
   // [start, end) problem-index range; navigation is confined to it. Defined here
   // (ahead of the nav derives below) since `canGoBack` reads `segBounds`.
   let segTotal = $derived(
      isSegmented ? segmentCount(history.length, segmentSize) : 1,
   );
   let segBounds = $derived<[number, number]>(
      isSegmented
         ? segmentRange(currentSegment, segmentSize, history.length)
         : [0, history.length],
   );
   let onLastSegment = $derived(
      isSegmented
         ? isLastSegment(currentSegment, history.length, segmentSize)
         : true,
   );
   let canSegmentForward = $derived(
      isSegmented && historyIndex < segBounds[1] - 1,
   );

   // Back is available either within the materialized history, or when a previous
   // problem has been prefetched from the server (any session). Segmented tests
   // confine Back to the current segment (no returning to a locked one).
   let canGoBack = $derived(
      isSegmented
         ? historyIndex > segBounds[0]
         : historyIndex > 0 || olderPrefetch != null,
   );
   let isProblemMcq = $derived(!!problem && (problem.choices?.length ?? 0) > 1);
   let cannotSubmit = $derived(
      !problem ||
         paused ||
         (isProblemMcq
            ? answerState.selectedChoice == null
            : !answerState.answer.trim()),
   );

   // ---- Test problem overview ("bubble sheet") --------------------------------
   // A grid of every problem in the test, color-coded by state, that also serves
   // as a jump target. Answered-ness for the on-screen problem reflects the live
   // (uncommitted) edits; every other cell reads its committed history entry.
   let overviewOpen = $state(false);

   function isAnsweredAt(index: number): boolean {
      if (index === historyIndex) {
         return isProblemMcq
            ? answerState.selectedChoice != null
            : !!answerState.answer.trim();
      }
      const entry = history[index];
      if (!entry) return false;
      const isMcq = (entry.problem.choices?.length ?? 0) > 1;
      return isMcq ? entry.selectedChoice != null : !!entry.answer.trim();
   }

   let answeredCount = $derived(
      isTest
         ? history.reduce((n, _entry, i) => n + (isAnsweredAt(i) ? 1 : 0), 0)
         : 0,
   );

   let overviewCells = $derived.by<ProblemGridCell[]>(() => {
      if (!isTest) return [];
      return history.map((entry, i) => {
         const current = i === historyIndex;
         const flagged = current ? answerState.flagged : entry.flagged;
         let state: ProblemGridCell["state"];
         // A graded entry (finished test, or a Countdown segment revealed early)
         // paints its recorded outcome; anything ungraded is just answered or not.
         if (entry.submitted && entry.correct !== null) {
            state = entry.correct ? "correct" : "incorrect";
         } else if (entry.skipped) {
            state = "skipped";
         } else {
            state = isAnsweredAt(i) ? "answered" : "unanswered";
         }
         // Mid-test segmented pacing locks earlier/future segments — only the
         // current segment's cells are jumpable.
         const disabled =
            isSegmented && !testFinished
               ? i < segBounds[0] || i >= segBounds[1]
               : false;
         return { label: entry.problem.n + 1, state, current, flagged, disabled };
      });
   });

   // Jump straight to a problem from the overview grid (pooled tests: anywhere;
   // segmented mid-test: only within the current, unlocked segment).
   function jumpToIndex(index: number) {
      overviewOpen = false;
      if (loading || index === historyIndex) return;
      if (index < 0 || index >= history.length) return;
      if (
         isSegmented &&
         !testFinished &&
         (index < segBounds[0] || index >= segBounds[1])
      )
         return;
      commitCurrent();
      restore(index);
   }

   // ---- Submit guards ---------------------------------------------------------
   // A stray click on "Submit test" / "Submit & continue" shouldn't silently end a
   // run (or burn a segment) with blanks. We confirm only when there's something to
   // warn about — a fully-answered submit goes straight through.
   let confirmOpen = $state(false);
   let confirmKind = $state<"submit" | "advance">("submit");
   let unansweredCount = $derived(
      isTest
         ? history.reduce((n, _entry, i) => n + (isAnsweredAt(i) ? 0 : 1), 0)
         : 0,
   );

   function requestSubmitTest() {
      if (submittingTest || testFinished || paused) return;
      if (unansweredCount > 0) {
         confirmKind = "submit";
         confirmOpen = true;
         return;
      }
      submitTest();
   }

   function requestAdvanceSegment() {
      if (submittingTest || testFinished || paused) return;
      // In reveal mode the grade-in-place beat is itself the "are you sure" step,
      // so skip the blank-segment confirm and let advanceSegment reveal/continue.
      if (revealPerSegment) {
         advanceSegment();
         return;
      }
      // Only guard a wholly-blank segment — the case where a stray click would
      // lock a segment the user never actually worked.
      const [start, end] = segBounds;
      let anyAnswered = false;
      for (let i = start; i < end; i++) {
         if (isAnsweredAt(i)) {
            anyAnswered = true;
            break;
         }
      }
      if (!anyAnswered) {
         confirmKind = "advance";
         confirmOpen = true;
         return;
      }
      advanceSegment();
   }

   function confirmProceed() {
      confirmOpen = false;
      if (confirmKind === "submit") submitTest();
      else advanceSegment();
   }

   let moreOptions = $derived<DropdownOption[]>([
      {
         label: settingsForm.focusMode ? "Disable Focus Mode" : "Focus Mode",
         icon: settingsForm.focusMode
            ? "center_focus_strong"
            : "center_focus_weak",
         iconFill: settingsForm.focusMode,
         onclick: () => setFocusMode(!settingsForm.focusMode),
      },
      {
         type: "divider",
      },
      {
         label: answerState.flagged ? "Unflag" : "Flag",
         icon: "flag",
         iconFill: answerState.flagged,
         color: answerState.flagged ? "text-unsure" : undefined,
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
         // A between-segment interstitial freezes the new segment's clock until
         // dismissed (always null for pooled tests / practice).
         interstitial == null &&
         // Formats that freeze on navigate only tick the latest, unanswered
         // problem; non-freezing formats (test) tick whatever is shown until
         // the run is finished.
         (behavior.freezeOnNavigate
            ? !answerState.submitted && isLatest
            : !testFinished && !segmentRevealed),
   );

   function elapsedAt(now: number) {
      return timerRunning
         ? Math.max(0, now - startedAt)
         : answerState.elapsedMs;
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
      settingsForm.timeLimitSeconds == null
         ? null
         : Math.max(
              0,
              settingsForm.timeLimitSeconds * 1000 - totalElapsedMs,
           ),
   );

   // Timed practice: a per-problem answering limit (practice format only). Its
   // countdown only applies to the active problem being answered — the latest,
   // unanswered one — so navigating back to review shows the normal count-up.
   let perProblemLimitMs = $derived(
      !isTest && settingsForm.perProblemSeconds != null
         ? settingsForm.perProblemSeconds * 1000
         : null,
   );
   let problemRemainingMs = $derived(
      perProblemLimitMs != null && !answerState.submitted && isLatest
         ? countdownRemainingMs(perProblemLimitMs, elapsedMs)
         : null,
   );

   // Segmented pacing: per-segment elapsed sums the segment's problems
   // (live-substituting the on-screen one), and the countdown floors at zero — no
   // carry-over from the total clock. (Geometry: `segBounds`/`segTotal`/… defined
   // higher, before the navigation derives that consume them.)
   let segmentElapsed = $derived(
      isSegmented
         ? segmentElapsedMs(
              currentSegment,
              segmentSize,
              history.length,
              (i) => (i === historyIndex ? elapsedMs : history[i]?.elapsedMs ?? 0),
           )
         : 0,
   );
   let segmentRemainingMs = $derived(
      isSegmented && secondsPerSegment != null
         ? countdownRemainingMs(secondsPerSegment * 1000, segmentElapsed)
         : null,
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
   let testSummary = $derived(summarizeTestResults(history));

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

   function currentSettings(): PracticeSettings {
      return practiceSettingsFromForm(settingsForm);
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
      settingsForm.focusMode = value;
      persistSettingsSnapshot({ ...currentSettings(), focusMode: value });
   }

   // Exact, non-reactive elapsed snapshot for event handlers / persistence.
   function liveElapsed() {
      return elapsedAt(Date.now());
   }

   // Save the live view state back into its history entry before navigating away.
   // Practice only: if the user leaves a graded problem without ever touching its
   // mastery, save the suggested value rather than leaving it unassessed. An
   // explicit choice (including clearing to "Unassessed") sets `masteryTouched` and
   // is respected. Fire-and-forget; the DB write mirrors the ProblemOrganization path.
   function maybeAutoAssignMastery() {
      if (!user || isTest) return;
      if (!problem || !answerState.submitted || answerState.correct === null) return;
      if (masteryTouched || currentProgress?.mastery) return;
      if (currentProgress) currentProgress.mastery = suggestedMastery;
      const id = problem.id;
      setProblemMastery(supabase, id, suggestedMastery).catch((e) =>
         console.error("Failed to auto-assign mastery:", e),
      );
   }

   function commitCurrent() {
      // Leaving the current problem: finish the life-bar's change animation now
      // so its tween/decay tail doesn't play out on the next problem.
      ratingBar?.settle();
      const entry = history[historyIndex];
      if (!entry) return;
      // Auto-apply the suggested mastery before snapshotting, so the committed
      // entry carries it too.
      maybeAutoAssignMastery();
      commitPracticeHistoryEntry(
         entry,
         {
            ...answerState,
            elapsedMs: liveElapsed(),
         },
         currentProgress,
      );
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
      answerState = restorePracticeAnswerState(entry);
      masteryTouched = false;
      segmentRevealed = false;

      const now = Date.now();
      timerNow = now;
      startedAt = now - entry.elapsedMs;
   }

   // Build a live history entry from a stored/fetched submission. Paged-in older
   // entries carry their `submissionId` (the back-paging cursor); freshly drawn
   // problems have none.
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
      answerState = createPracticeAnswerState();
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
               createPracticeHistoryEntry({
                  problem: result.problem,
                  source: result.source,
                  progress: result.progress,
               }),
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
         answerState.elapsedMs = Date.now() - now;
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
         return answerState.selectedChoice == null
            ? null
            : `c:${answerState.selectedChoice}`;
      }
      const normalized = normalizeAnswer(answerState.answer);
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
   let ratingBar = $state<RatingBarHandle>();
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

   // `force` finalizes on this submit even if tries remain (used when the
   // per-problem timer expires — time's up, no more retries).
   function submitAnswer(force = false) {
      // Per-answer grading is only for formats that grade immediately; test
      // defers all grading to submitTest().
      if (!behavior.gradeImmediately) return;
      if (!problem || answerState.submitted || paused) return;
      if (isProblemMcq && answerState.selectedChoice == null) return;
      if (!isProblemMcq && !answerState.answer.trim()) return;

      // Reject a repeat of a previously-tried answer: flash feedback but don't
      // consume a try — the user simply hasn't offered anything new.
      const key = currentAnswerKey();
      if (key != null && answerState.triedAnswers.includes(key)) {
         answerFeedback?.trigger(true);
         toasts.warning("You already tried that answer.");
         return;
      }

      const elapsed = Math.max(0, Date.now() - startedAt);
      // Answerless problems run ungraded: there's nothing to compare against,
      // so record the attempt as seen-but-not-graded (isCorrect = null).
      const isCorrect = hasAnswer
         ? isProblemMcq
            ? answerState.selectedChoice === problem.answer_index
            : answersMatch(
                 answerState.answer,
                 problem.choices?.[problem.answer_index ?? 0] ?? "",
              )
         : null;

      // Multi-try: a graded wrong answer with tries still remaining doesn't
      // finalize the problem. Remember the tried answer, flash the shake
      // feedback (without revealing the correct answer), and let the user retry.
      // Correct answers and ungraded problems always finalize on submit.
      if (
         !force &&
         isCorrect === false &&
         answerState.triesUsed + 1 < settingsForm.triesPerProblem
      ) {
         if (key != null) {
            answerState.triedAnswers = [...answerState.triedAnswers, key];
         }
         answerState.triesUsed += 1;
         answerFeedback?.trigger(true);
         return;
      }

      answerState.submitted = true;
      answerState.correct = isCorrect;
      answerState.elapsedMs = elapsed;
      answerState.attemptIndex = attempts.length;
      attempts = [
         ...attempts,
         {
            problemId: problem.id,
            selectedChoice: answerState.selectedChoice,
            correct: isCorrect,
            elapsedMs: elapsed,
            skipped: false,
            flagged: answerState.flagged,
         },
      ];

      if (user) {
         const recorded = recordSubmission(supabase, user.id, {
            problemId: problem.id,
            selectedChoice: answerState.selectedChoice,
            answer: isProblemMcq ? null : answerState.answer,
            isCorrect,
            skipped: false,
            flagged: answerState.flagged,
            elapsedMs: elapsed,
            source: currentSource,
            sessionId: currentSessionId,
            // Wrong tries burned before this final outcome (0 = first-try).
            triesUsed: answerState.triesUsed,
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
      answerState.attemptIndex = attempts.length;
      attempts = [
         ...attempts,
         {
            problemId: problem.id,
            selectedChoice: answerState.selectedChoice,
            correct: null,
            elapsedMs: elapsed,
            skipped: true,
            flagged: answerState.flagged,
         },
      ];

      if (user) {
         recordSubmission(supabase, user.id, {
            problemId: problem.id,
            selectedChoice: null,
            isCorrect: null,
            skipped: true,
            flagged: answerState.flagged,
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

   // Timed practice: the per-problem clock hit zero. Finalize the current problem
   // *in place* — grade the entered answer (forced final, no retries), or record a
   // timeout skip when blank — and reveal it. We deliberately do NOT advance; the
   // user reviews the result and clicks Next when ready (same as a normal submit).
   function handleTimeExpired() {
      if (isTest || paused || !problem || loading || answerState.submitted) return;
      const hasInput = isProblemMcq
         ? answerState.selectedChoice != null
         : !!answerState.answer.trim();
      if (hasInput) {
         submitAnswer(true);
         return;
      }
      // Blank at expiry: record the skip, then freeze + reveal in place so the
      // problem resolves (marks submitted → answer shown, input disabled, Next).
      recordSkip();
      answerState.elapsedMs = liveElapsed();
      answerState.submitted = true;
   }

   function goBack() {
      if (!canGoBack || loading) return;
      commitCurrent();
      // Segmented tests never leave the current segment.
      if (isSegmented) {
         if (historyIndex > segBounds[0]) restore(historyIndex - 1);
         return;
      }
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
         olderPrefetch = practiceHistoryEntryFromSubmission(row);
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
         // Segmented: step only within the current segment; crossing a boundary
         // is the "Submit & continue" action, not a plain Next.
         if (isSegmented) {
            if (historyIndex >= segBounds[1] - 1) return;
            commitCurrent();
            restore(historyIndex + 1);
            return;
         }
         if (isLatest) return;
         commitCurrent();
         restore(historyIndex + 1);
         return;
      }
      if (isLatest) {
         if (answerState.submitted) return;
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
      answerState.flagged = !answerState.flagged;
      if (answerState.attemptIndex == null) return;

      attempts = attempts.map((attempt, i) =>
         i === answerState.attemptIndex
            ? { ...attempt, flagged: answerState.flagged }
            : attempt,
      );
   }

   function togglePause() {
      if (!behavior.allowPause) return;
      if (!problem || loading) return;
      // In a test the clock runs for whichever problem is shown until the final
      // submit, so pausing is allowed any time before the run is finished (but
      // not while a between-segment interstitial is up). In practice only the
      // live (latest, unanswered) problem's clock can be paused.
      if (
         isTest
            ? testFinished || interstitial != null
            : answerState.submitted || !isLatest
      )
         return;
      if (paused) {
         startedAt = Date.now() - answerState.elapsedMs;
         paused = false;
      } else {
         answerState.elapsedMs = liveElapsed();
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
            if (settingsForm.format === "test") {
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
      void answerState.selectedChoice;
      void answerState.answer;
      void answerState.flagged;
      void historyIndex;
      void history.length;
      void currentSegment;
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

   // Auto-submit a *pooled* timed test the moment the single clock runs out.
   // Segmented tests run their own per-segment expiry (below), never this.
   $effect(() => {
      if (!isTest || isSegmented || testFinished || submittingTest) return;
      if (settingsForm.timeLimitSeconds != null && remainingMs === 0) {
         submitTest();
      }
   });

   // Segmented Test pacing: on strict timing, lock + advance the moment the
   // current segment's clock hits zero (the last segment's expiry submits the
   // test). Lenient timing skips this — the clock runs red and the user drives
   // "Submit & continue". Frozen while an interstitial is up.
   $effect(() => {
      if (!isSegmented || testFinished || submittingTest || loading) return;
      // Once revealed, the clock is frozen and the user drives the advance —
      // don't let a lingering 0:00 auto-advance past the revealed result.
      if (!strictTiming || interstitial != null || segmentRevealed) return;
      if (segmentRemainingMs === 0) {
         advanceSegment();
      }
   });

   // Timed practice: auto-finish + advance the moment the per-problem clock hits
   // zero. `problemRemainingMs` is only non-null for the active (latest,
   // unanswered) problem, and `timerRunning` gates out paused/loading/frozen
   // states, so this fires exactly once per problem.
   $effect(() => {
      if (!timerRunning) return;
      if (problemRemainingMs === 0) {
         handleTimeExpired();
      }
   });
</script>

<div class="flex h-full w-full flex-col gap-0 overflow-hidden">
   <PracticeTopbar
      sessionName={activeSession?.name ?? null}
      {isTest}
      {showSettings}
      {playerRating}
      bind:ratingBar
      showLiveFeedback={behavior.showLiveFeedback}
      {focusModeActive}
      {correctAttempts}
      {incorrectAttempts}
      {skippedAttempts}
      {testFinished}
      historyLength={history.length}
      {answeredCount}
      onOpenOverview={() => (overviewOpen = true)}
      showTestClock={!isSegmented}
      timeLimitSeconds={settingsForm.timeLimitSeconds}
      {remainingMs}
      {totalElapsedMs}
      problemVisible={!!problem}
      {loading}
      allowPause={behavior.allowPause}
      submitted={answerState.submitted}
      {isLatest}
      {paused}
      bind:timerMode
      {elapsedMs}
      {problemRemainingMs}
      onToggleSettings={() => (showSettings = !showSettings)}
      onTogglePause={togglePause}
   />

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
            <TestResults
               {history}
               summary={testSummary}
               elapsedMs={testElapsedTotalMs}
            />
         {:else if isTest && history.length === 0}
            <div
               class="flex-1 flex flex-col items-center justify-center gap-4 text-center"
            >
               <div
                  class="flex size-10 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
               >
                  <Icon name="quiz" fontsize={20} />
               </div>
               <div class="flex max-w-3xl flex-col gap-1">
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
               <div class="flex max-w-3xl flex-col gap-1">
                  <h2 class="text-sm font-semibold">No matching problems</h2>
                  <p class="text-xs text-muted-foreground">
                     {#if settingsForm.mode === "skipped"}
                        You've gone through every unsolved skipped problem that
                        matches these settings. Reset to cycle through them
                        again, or broaden the settings.
                     {:else if settingsForm.mode === "review" || settingsForm.mode === "mixed"}
                        You've gone through everything queued this session.
                        Reset to cycle through them again, or broaden the
                        settings.
                     {:else}
                        Try broadening the settings, then generate again.
                     {/if}
                  </p>
               </div>
               <div class="flex items-center gap-2">
                  {#if settingsForm.mode === "review" || settingsForm.mode === "skipped" || settingsForm.mode === "mixed"}
                     <Button size="sm" onclick={resetSession} class="gap-1.5">
                        <Icon name="restart_alt" />
                        {settingsForm.mode === "skipped"
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
               {#if isSegmented && !testFinished}
                  <div
                     class="flex items-center justify-between gap-3 border-b border-border/50 px-6 py-2"
                  >
                     <div class="flex min-w-0 flex-col">
                        <span class="text-xs font-semibold text-foreground">
                           {segmentSize === 1
                              ? `Problem ${currentSegment + 1} of ${segTotal}`
                              : `Pair ${currentSegment + 1} of ${segTotal}`}
                        </span>
                        <span class="text-[10px] text-muted-foreground">
                           {strictTiming
                              ? "Locks at 0:00 — no going back"
                              : "You may overrun — submit when ready"}
                        </span>
                     </div>
                     {#if segmentRemainingMs != null}
                        <Countdown
                           remainingMs={segmentRemainingMs}
                           label="Time left in this segment"
                           icon="timer"
                        />
                     {/if}
                  </div>
               {/if}
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
                        revealLinks={answerState.submitted}
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
                           bind:answer={answerState.answer}
                           bind:selectedChoice={answerState.selectedChoice}
                           bind:eliminated={answerState.eliminatedChoices}
                           showAnswerState={(behavior.revealAnswerState ||
                              revealActive) &&
                              answerState.submitted &&
                              hasAnswer}
                           disabled={behavior.freezeOnNavigate
                              ? answerState.submitted || !isLatest || paused
                              : revealActive || paused}
                           onEnter={behavior.gradeImmediately
                              ? () => submitAnswer()
                              : revealPerSegment && !segmentRevealed && !paused
                                ? () => advanceSegment()
                                : undefined}
                        />
                     </div>

                     {#if behavior.gradeImmediately && answerState.submitted && answerState.correct !== null}
                        <ProblemOrganization
                           class="w-full"
                           problemId={problem.id}
                           mastery={currentProgress?.mastery ?? null}
                           engagement={currentProgress?.engagement ?? null}
                           prompt={!currentProgress?.mastery}
                           {suggestedMastery}
                           onchange={(state) => {
                              masteryTouched = true;
                              currentProgress = currentProgress ?? {
                                 times_seen: 1,
                                 times_reviewed: 1,
                                 times_correct: answerState.correct ? 1 : 0,
                                 times_skipped: 0,
                                 last_submission_at: new Date().toISOString(),
                                 last_reviewed_at: new Date().toISOString(),
                                 last_correct: answerState.correct,
                                 next_review_at: null,
                                 solved: answerState.correct === true,
                                 mastery: null,
                                 engagement: null,
                              };
                              currentProgress.mastery = state.mastery;
                              currentProgress.engagement = state.engagement;
                           }}
                        />
                     {/if}

                     <!-- Official worked solutions, revealed once the problem
                                 is finalized. Auto-opens on a wrong answer; keyed per
                                 problem so its open/selection state re-seeds. -->
                     {#if solutionShown}
                        {#key problem.id}
                           <ProblemSolution
                              class="w-full"
                              solutions={problem.official_solutions}
                              defaultOpen={answerState.correct === false}
                           />
                        {/key}
                     {/if}
                  </div>

                  {#if paused}
                     <PauseOverlay
                        {isTest}
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

                  {#if interstitial}
                     <div
                        class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/95 px-6 text-center backdrop-blur-(--backdrop-blur)"
                        transition:fade={{ duration: 150 }}
                     >
                        <div
                           class="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
                        >
                           <Icon
                              name={segmentSize === 1 ? "bolt" : "layers"}
                              fontsize={24}
                           />
                        </div>
                        <div class="flex flex-col gap-1">
                           <h2 class="text-lg font-semibold">
                              {segmentSize === 1
                                 ? `Problem ${interstitial.segment + 1} of ${segTotal}`
                                 : `Pair ${interstitial.segment + 1} of ${segTotal}`}
                           </h2>
                           <p class="text-xs text-muted-foreground">
                              {#if segmentSize === 1}
                                 Starting…
                              {:else}
                                 Previous pair locked{secondsPerSegment != null
                                    ? ` · ${Math.round(secondsPerSegment / 60)} min`
                                    : ""}
                              {/if}
                           </p>
                        </div>
                        {#if segmentSize > 1}
                           <Button
                              size="sm"
                              class="gap-1.5"
                              onclick={dismissInterstitial}
                           >
                              Start pair
                              <Icon name="arrow_forward" />
                           </Button>
                        {/if}
                     </div>
                  {/if}
               </div>

               <PracticeFooter
                  gradeImmediately={behavior.gradeImmediately}
                  {isLatest}
                  submitted={answerState.submitted}
                  {paused}
                  {focusModeActive}
                  {canGoBack}
                  segmented={isSegmented}
                  {canSegmentForward}
                  lastSegment={onLastSegment}
                  revealMode={revealPerSegment}
                  {segmentRevealed}
                  onAdvanceSegment={requestAdvanceSegment}
                  flagged={answerState.flagged}
                  {moreOptions}
                  {submittingTest}
                  {cannotSubmit}
                  {hasAnswer}
                  triesUsed={answerState.triesUsed}
                  triesPerProblem={settingsForm.triesPerProblem}
                  {triesRemaining}
                  {playerRating}
                  {ratingDelta}
                  onBack={goBack}
                  onForward={goForward}
                  onJumpToLatest={jumpToLatest}
                  onLoadProblem={() => loadProblem()}
                  onSubmitAnswer={() => submitAnswer()}
                  onSubmitTest={requestSubmitTest}
               />
            </div>
         {/if}
      </main>

      <!-- Sidebar settings panel -->
      {#if showSettings}
         <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
         <div
            class="fixed inset-0 z-40 bg-black/40 backdrop-blur-(--backdrop-blur) lg:hidden"
            onclick={() => (showSettings = false)}
            transition:fade={{ duration: 200 }}
         ></div>
      {/if}
      <SettingsPanel
         bind:form={settingsForm}
         {seriesOptions}
         {seriesScopeConfigs}
         canReview={!!user}
         {isTest}
         {testName}
         timeLimitSeconds={settingsForm.timeLimitSeconds}
         pacing={settingsForm.pacing}
         strictTiming={settingsForm.strictTiming ?? true}
         onFocusModeChange={setFocusMode}
         onClose={() => (showSettings = false)}
         open={showSettings}
      />

      {#if isTest}
         <Modal
            bind:open={overviewOpen}
            title="Problems"
            description={`${answeredCount} of ${history.length} answered`}
            size="lg"
            onClose={() => (overviewOpen = false)}
         >
            <ProblemGrid cells={overviewCells} onSelect={jumpToIndex} />
            <div
               class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground"
            >
               {#if testFinished || revealPerSegment}
                  {@render swatch("bg-correct/60", "Correct")}
                  {@render swatch("bg-destructive/60", "Incorrect")}
                  {@render swatch("bg-unsure/60", "Skipped")}
               {:else}
                  {@render swatch("bg-primary/60", "Answered")}
                  {@render swatch("bg-surface-container border border-border/60", "Not answered")}
               {/if}
               <span class="inline-flex items-center gap-1.5">
                  <Icon name="flag" class="size-[1em] text-unsure" fill />
                  Flagged
               </span>
            </div>
         </Modal>

         <Modal
            bind:open={confirmOpen}
            size="sm"
            title={confirmKind === "advance"
               ? "Submit this round?"
               : "Submit test?"}
         >
            <p class="text-sm text-muted-foreground">
               {#if confirmKind === "advance"}
                  You haven't answered anything in this round. Continuing locks it
                  — you won't be able to come back.
               {:else}
                  {unansweredCount}
                  {unansweredCount === 1 ? "problem is" : "problems are"} still
                  unanswered. Submit anyway, or go back and finish them.
               {/if}
            </p>
            {#snippet footer()}
               <Button
                  variant="outline"
                  size="sm"
                  onclick={() => (confirmOpen = false)}
               >
                  Keep working
               </Button>
               <Button
                  size="sm"
                  onclick={confirmProceed}
                  class="bg-primary text-primary-foreground hover:bg-primary/95"
               >
                  {confirmKind === "advance" ? "Continue" : "Submit anyway"}
               </Button>
            {/snippet}
         </Modal>
      {/if}
   </div>
</div>

{#snippet swatch(cls: string, label: string)}
   <span class="inline-flex items-center gap-1.5">
      <span class={cn("inline-block size-3 rounded-[3px]", cls)}></span>
      {label}
   </span>
{/snippet}
