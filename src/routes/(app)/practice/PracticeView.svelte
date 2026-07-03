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
    import { Problem, ProblemAnswer } from "$lib/components/problem";
    import { type TriState } from "$lib/components/toggle";
    import {
        DIFFICULTY_RANGE,
        boolToTri,
        topicLabel,
        triToBool,
        type ProblemRow,
        fetchAllSeries,
    } from "$lib/library";
    import {
        createSession,
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
        setCurrentProblem,
        updateSessionSettings,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import { cn, formatElapsed } from "$lib/utils";
    import { modal } from "$lib/state/modal.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { StatusTag } from "$lib/components/status-tag";
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
    let showSettings = $state(false);
    let paused = $state(false);

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
    let submittingTest = $state(false);

    // Review/Mixed need per-user progress. Without a session, pin to New.
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

    // Last settings snapshot persisted to the session, to skip redundant writes.
    let lastPersistedSettings = "";

    // Write a stored PracticeSettings snapshot back into the panel's bound state
    // (the inverse of currentSettings()), so resuming a session restores its filters.
    function applySettings(s: PracticeSettings) {
        format = s.format ?? "practice";
        testId = s.testId ?? null;
        timeLimitSeconds = s.timeLimitSeconds ?? null;
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
        const applyCounter = (
            key: CounterKey,
            range: [number, number] | null,
        ) => {
            counterEnabled[key] = range != null;
            counterRanges[key] = range
                ? [range[0], range[1]]
                : [...COUNTER_RANGE];
        };
        applyCounter("seen", s.timesSeen);
        applyCounter("reviewed", s.timesReviewed);
        applyCounter("correct", s.timesCorrect);
        applyCounter("skipped", s.timesSkipped);
        lastSubmissionDays = s.lastSubmissionDays;
        lastOutcome = s.lastOutcome;
        includeUnscheduled = s.includeUnscheduled;
    }

    async function finishSession() {
        if (!activeSession || sessionBusy) return;
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
                        x.problem.n - y.problem.n ||
                        x.problem.id - y.problem.id,
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
            }));

            // Restore any in-progress draft (answers + per-problem time + place).
            const draft = loadTestDraft(s.id);
            if (draft) {
                const byId = new Map(
                    draft.answers.map((a) => [a.problemId, a]),
                );
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
                        : (!e.answer || !e.answer.trim());
                    const isCorrect = skipped
                        ? null
                        : (isMcq
                            ? e.selectedChoice === e.problem.answer_index
                            : e.answer.trim() === e.problem.choices?.[e.problem.answer_index ?? 0]?.trim());
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
        setCurrentProblem(
            supabase,
            currentSessionId,
            problemId,
            elapsedMs,
        ).catch((e) => console.error("Failed to persist session problem:", e));
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
            },
        ];
        restore(history.length - 1);
        loading = false;
        paused = false;
    }

    // Browser-history-style navigation: every generated problem is appended to
    // `history`; `historyIndex` points at the one on screen. Past entries are
    // frozen snapshots; only the latest entry is live (timer runs, answerable).
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
    };
    let history = $state<HistoryEntry[]>([]);
    let historyIndex = $state(-1);

    let problem = $state<ProblemRow | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let selectedChoice = $state<number | null>(null);
    let answer = $state("");
    let submitted = $state(false);
    let correct = $state<boolean | null>(null);
    let flagged = $state(false);
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
    let canGoBack = $derived(historyIndex > 0);
    let isProblemMcq = $derived(!!problem && (problem.choices?.length ?? 0) > 1);
    let cannotSubmit = $derived(
        !problem ||
            paused ||
            (isProblemMcq ? selectedChoice == null : !answer.trim()),
    );

    let moreOptions = $derived<DropdownOption[]>([
        {
            label: flagged ? "Unflag" : "Flag",
            icon: "flag",
            iconFill: flagged,
            color: flagged ? "text-unsure" : undefined,
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
            (behavior.freezeOnNavigate
                ? !submitted && isLatest
                : !testFinished),
    );

    function elapsedAt(now: number) {
        return timerRunning ? Math.max(0, now - startedAt) : frozenElapsedMs;
    }

    let elapsedMs = $derived(elapsedAt(timerNow));

    // Total time across the whole session: every problem in this view's history
    // (prior work is rebuilt into it on resume), substituting the live count for
    // the on-screen one.
    let totalElapsedMs = $derived(
        history.reduce(
            (sum, entry, i) =>
                sum + (i === historyIndex ? elapsedMs : entry.elapsedMs),
            0,
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
    let testCorrect = $derived(
        history.filter((e) => e.correct === true).length,
    );
    let testIncorrect = $derived(
        history.filter((e) => e.submitted && e.correct === false).length,
    );
    let testSkipped = $derived(
        history.filter((e) => {
            const isMcq = (e.problem.choices?.length ?? 0) > 1;
            return isMcq ? e.selectedChoice == null : (!e.answer || !e.answer.trim());
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
    // Hoisted out of the template so they aren't recomputed in both the
    // {#if} guard and the rendered value.
    let topicName = $derived(problem ? topicLabel(problem.topic) : null);
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
    let lastReviewedLabel = $derived(
        currentProgress
            ? formatReviewDate(currentProgress.lastSubmissionAt)
            : null,
    );

    function counterFilter(key: keyof CounterRanges): [number, number] | null {
        return counterEnabled[key] ? [...counterRanges[key]] : null;
    }

    function currentSettings(): PracticeSettings {
        return {
            mode,
            format,
            testId,
            timeLimitSeconds,
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
            timesSeen: counterFilter("seen"),
            timesReviewed: counterFilter("reviewed"),
            timesCorrect: counterFilter("correct"),
            timesSkipped: counterFilter("skipped"),
            lastSubmissionDays,
            lastOutcome,
            includeUnscheduled,
        };
    }

    // Compact "last reviewed" label: relative for recent, short date otherwise.
    function formatReviewDate(iso: string | null) {
        if (!iso) return null;
        const then = new Date(iso);
        const days = Math.floor((Date.now() - then.getTime()) / 86400000);
        if (days <= 0) return "today";
        if (days === 1) return "yesterday";
        if (days < 30) return `${days}d ago`;
        return then.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });
    }

    // Exact, non-reactive elapsed snapshot for event handlers / persistence.
    function liveElapsed() {
        return elapsedAt(Date.now());
    }

    // Save the live view state back into its history entry before navigating away.
    function commitCurrent() {
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

        const now = Date.now();
        timerNow = now;
        frozenElapsedMs = entry.elapsedMs;
        startedAt = now - entry.elapsedMs;
    }

    async function loadProblem(settings = currentSettings()) {
        const token = ++loadToken;
        const now = Date.now();

        // Persist settings changes back to the active session so a later resume
        // restores them. Fire-and-forget; deduped against the last write.
        if (currentSessionId != null) {
            const serialized = JSON.stringify(settings);
            if (serialized !== lastPersistedSettings) {
                lastPersistedSettings = serialized;
                updateSessionSettings(
                    supabase,
                    currentSessionId,
                    settings,
                ).catch((e) =>
                    console.error("Failed to persist session settings:", e),
                );
            }
        }

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
        frozenElapsedMs = 0;
        startedAt = now;
        timerNow = now;
        paused = false;

        try {
            const result = await nextPracticeProblem(
                supabase,
                settings,
                session,
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
        const trimmed = answer.trim();
        return trimmed ? `a:${trimmed}` : null;
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
            ? (isProblemMcq
                ? selectedChoice === problem.answer_index
                : answer.trim() === problem.choices?.[problem.answer_index ?? 0]?.trim())
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
            recordSubmission(supabase, user.id, {
                problemId: problem.id,
                selectedChoice,
                isCorrect,
                skipped: false,
                flagged,
                elapsedMs: elapsed,
                source: currentSource,
                sessionId: currentSessionId,
            });
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
        restore(historyIndex - 1);
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

    // Resolve the session from the URL, hydrate its settings, then load the
    // first problem. Settings are intentionally *not* a reactive dependency of
    // loadProblem: the panel applies them to the next generated problem (via
    // currentSettings()), so tweaking a control must not fire a reload per change.
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

        if (!isRoot && user) {
            try {
                const s = await fetchSession(supabase, Number(sessionParam));
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

                    // Rebuild this view's back-navigation history from prior
                    // submissions (oldest first) as frozen entries, so a resumed
                    // session can be paged back through. The same data seeds the
                    // draw-state (so the queue doesn't repeat) and the carried-
                    // over outcome tallies, keeping the indicators continuous.
                    const prior = await fetchSessionHistory(supabase, s.id);
                    history = prior.map((a) => ({
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
                    }));
                    for (const a of prior) session.shownIds.add(a.problem.id);
                    session.drawIndex = prior.length;
                    sessionAttemptCount = prior.length;
                    priorSkipped = prior.filter((a) => a.skipped).length;
                    priorCorrect = prior.filter(
                        (a) => a.isCorrect === true,
                    ).length;
                    priorIncorrect = prior.filter(
                        (a) => a.isCorrect === false,
                    ).length;

                    // Resume the in-progress problem instead of generating a new
                    // one, continuing its elapsed timer where it left off.
                    if (s.current_problem_id != null) {
                        const pending = await fetchProblemById(
                            s.current_problem_id,
                        );
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
                    {@render statChip(
                        testIncorrect,
                        "var(--color-destructive)",
                    )}
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
                    {@const entryMcq = (entry.problem.choices?.length ?? 0) > 1}
                    <div
                        class="rounded-lg border border-border/50 bg-surface-container-lowest p-4"
                    >
                        <div class="mb-3 flex items-center gap-2 text-xs">
                            <span class="font-mono text-muted-foreground">
                                #{entry.problem.n + 1}
                            </span>
                            <StatusTag
                                size="sm"
                                status={(entryMcq ? entry.selectedChoice == null : (!entry.answer || !entry.answer.trim()))
                                    ? "skipped"
                                    : entry.correct
                                      ? "correct"
                                      : "incorrect"}
                            />
                            {#if entry.flagged}
                                <Icon
                                    name="flag"
                                    class="size-[1.1em] text-unsure"
                                    fill
                                />
                            {/if}
                        </div>
                        <Problem
                            problem={entry.problem}
                            selectedChoice={entry.selectedChoice}
                            answer={entry.answer}
                            showAnswerState={true}
                            disabled={true}
                            mode="preview"
                        />
                    </div>
                {/each}
            </div>

            <div class="flex justify-center pt-2">
                <Button variant="outline" href="/practice">
                    Back to sessions
                </Button>
            </div>
        </div>
    </div>
{/snippet}

<div class="flex h-full w-full flex-col gap-0 overflow-hidden">
    <TopbarRegister left={topbarLeft} right={topbarRight} />
{#snippet topbarLeft()}
    <div class="flex items-center">
        <a
            href="/practice"
            class="inline-flex items-center rounded-md h-8 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Back to sessions"
        >
            <Icon name="arrow_back" class={iconCls} />
        </a>

        <Button
            variant="ghost"
            size="sm"
            class={cn(
                "text-muted-foreground hover:text-foreground text-xs font-normal gap-1.5 px-2.5",
                showSettings && "bg-muted text-foreground",
            )}
            onclick={() => (showSettings = !showSettings)}
            aria-expanded={showSettings}
            aria-label="Toggle settings"
            disabled={paused}
        >
            <Icon name="tune" class={iconCls} />
        </Button>

        {#if activeSession}
            <div class="flex flex-row items-center gap-1.5">
                {#if isTest}
                    <span
                        class="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary"
                    >
                        <Icon name="quiz" class="size-[1em]" />
                        Test
                    </span>
                {/if}
                <span class="opacity-50 text-xs">{activeSession.name}</span>
            </div>
        {/if}
    </div>
{/snippet}

{#snippet topbarRight()}
    <div
        class="flex items-center gap-2 text-xs font-mono text-muted-foreground w-full min-w-0"
    >
        {#if behavior.showLiveFeedback}
            {@render statChip(correctAttempts, "var(--color-correct)")}
            {@render statChip(
                incorrectAttempts,
                "var(--color-destructive)",
            )}
            {@render statChip(skippedAttempts, "var(--color-unsure)")}
            <SegmentBar
                class="min-w-10 w-full shrink h-2"
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
                <div
                    class={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5",
                        low
                            ? "bg-destructive/15 text-destructive"
                            : "bg-surface-container-low",
                    )}
                    title={timed ? "Time remaining" : "Elapsed time"}
                    aria-label={timed ? "Time remaining" : "Elapsed time"}
                >
                    <Icon
                        name={timed ? "timer" : "schedule"}
                        class={iconCls}
                    />
                    <span class="leading-none tabular-nums">
                        {formatElapsed(
                            timed ? (remainingMs ?? 0) : totalElapsedMs,
                        )}
                    </span>
                </div>
            {/if}
        {:else if problem}
            {@const isTotal = timerMode === "total"}
            <div class="flex items-center gap-1.5">
                {#if behavior.allowPause && !submitted && isLatest}
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
                <button
                    type="button"
                    onclick={() =>
                        (timerMode = isTotal ? "problem" : "total")}
                    class="inline-flex h-8 items-center gap-1 rounded-md bg-surface-container-low px-2.5 transition-colors hover:bg-surface-container"
                    title={isTotal
                        ? "Total session time — click for this problem"
                        : "Time on this problem — click for session total"}
                    aria-label={isTotal
                        ? "Total session time"
                        : "Time on this problem"}
                    disabled={paused}
                >
                    <Icon
                        name={isTotal ? "timelapse" : "schedule"}
                        class={iconCls}
                    />
                    <span class="leading-none">
                        {formatElapsed(
                            isTotal ? totalElapsedMs : elapsedMs,
                        )}
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
                    <div class="flex max-w-sm flex-col gap-1">
                        <h2 class="text-sm font-semibold">
                            {isTest
                                ? "Could not load the test"
                                : "Could not load a problem"}
                        </h2>
                        <p class="text-xs text-muted-foreground">{error}</p>
                    </div>
                    {#if isTest}
                        <Button
                            size="sm"
                            onclick={() => window.location.reload()}
                            >Retry</Button
                        >
                    {:else}
                        <Button size="sm" onclick={() => loadProblem()}
                            >Retry</Button
                        >
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
                            None of its problems have a statement and choices
                            yet.
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
                        <h2 class="text-sm font-semibold">
                            No matching problems
                        </h2>
                        <p class="text-xs text-muted-foreground">
                            {#if mode === "review" || mode === "mixed"}
                                You've gone through everything queued this
                                session. Reset to cycle through them again, or
                                broaden the settings.
                            {:else}
                                Try broadening the settings, then generate
                                again.
                            {/if}
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        {#if mode === "review" || mode === "mixed"}
                            <Button
                                size="sm"
                                onclick={resetSession}
                                class="gap-1.5"
                            >
                                <Icon name="restart_alt" />
                                Reset review queue
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
                            <div
                                class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-background/80 px-1 pt-2.5 pb-2.5 backdrop-blur-(--backdrop-blur) select-none w-full overflow-visible"
                            >
                                <div
                                    class="flex items-center gap-2 text-xs font-semibold opacity-50 tracking-wider uppercase text-muted-foreground min-w-0"
                                >
                                    {#if problem.tests?.name}
                                        <span class="truncate"
                                            >{problem.tests.name}</span
                                        >
                                        <span class="text-border shrink-0"
                                            >•</span
                                        >
                                    {/if}
                                    <span class="shrink-0"
                                        >#{problem.n + 1}</span
                                    >
                                    {#if topicName}
                                        <span class="text-border shrink-0"
                                            >•</span
                                        >
                                        <span class="truncate" title={topicName}
                                            >{topicName}</span
                                        >
                                    {/if}
                                </div>

                                <div
                                    class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground shrink-0"
                                >
                                    {#if !hasAnswer}
                                        <StatusTag
                                            status="unanswered"
                                            size="sm"
                                            class="border-unsure/60 bg-unsure/20 text-on-unsure-container [--attention-color:var(--color-unsure)] animate-attention-pulse hover:animate-none focus-visible:animate-none motion-reduce:animate-none"
                                            action={{
                                                label: "Suggest",
                                                icon: "add",
                                                onclick: openAnswerSubmission,
                                            }}
                                        />
                                    {/if}
                                    {#if behavior.showLiveFeedback}
                                        {#if currentSource === "review"}
                                            <StatusTag
                                                status="review"
                                                size="sm"
                                            />
                                            {#if currentProgress}
                                                <span
                                                    class="inline-flex items-center gap-1"
                                                >
                                                    <Icon
                                                        name="visibility"
                                                        class={iconCls}
                                                    />
                                                    Seen {currentProgress.timesSeen}×
                                                </span>
                                                {#if lastReviewedLabel}
                                                    <span class="text-border"
                                                        >•</span
                                                    >
                                                    <span
                                                        class="inline-flex items-center gap-1"
                                                        title="Last reviewed"
                                                    >
                                                        <Icon
                                                            name="schedule"
                                                            class={iconCls}
                                                        />
                                                        {lastReviewedLabel}
                                                    </span>
                                                {/if}
                                            {/if}
                                        {:else}
                                            <StatusTag status="new" size="sm" />
                                        {/if}
                                    {:else if isTest}
                                        <span class="font-mono">
                                            {historyIndex + 1} / {history.length}
                                        </span>
                                    {/if}
                                </div>
                            </div>
                            <div
                                class="flex flex-1 min-h-fit w-full items-center justify-center"
                            >
                                <MathStatement
                                    text={problem.statement ?? ""}
                                    class="font-serif text-lg md:text-xl text-foreground leading-relaxed text-left w-full max-w-4xl py-2"
                                />
                            </div>
                            <div class="w-full">
                                <ProblemAnswer
                                    bind:this={answerFeedback}
                                    choices={problem.choices}
                                    answerIndex={problem.answer_index}
                                    bind:answer
                                    bind:selectedChoice
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
                        </div>

                        {#if paused}
                            <div
                                class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 text-center bg-background/60 backdrop-blur-(--backdrop-hide) px-4 select-none"
                                transition:fade={{ duration: 150 }}
                            >
                                <div
                                    class="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary shadow-inner border border-primary/20 animate-pulse"
                                >
                                    <Icon name="pause" fontsize={32} />
                                </div>
                                <div class="flex max-w flex-col gap-2">
                                    <h2
                                        class="text-lg font-semibold text-foreground tracking-tight"
                                    >
                                        Paused
                                    </h2>
                                    <p
                                        class="text-xs text-muted-foreground leading-relaxed"
                                    >
                                        The timer has halted.
                                    </p>
                                </div>
                                <Button
                                    size="default"
                                    onclick={togglePause}
                                    class="gap-2 px-6 h-10 shadow-md font-semibold bg-primary hover:bg-primary/95 text-primary-foreground transition-all duration-200 hover:scale-105 active:scale-95"
                                >
                                    <Icon name="play_arrow" />
                                </Button>
                            </div>
                        {/if}
                    </div>

                    <!-- Footer with ghosted Flag/Skip and primary Next/Submit buttons -->
                    <footer
                        class="sticky bottom-0 z-10 px-2 py-1 flex items-center justify-between w-full border-t border-border/50 bg-background/80"
                    >
                        <div
                            class="absolute inset-0 -z-10 bg-background/80 backdrop-blur-(--backdrop-blur) pointer-events-none"
                        ></div>
                        {#if !behavior.gradeImmediately}
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
                                        disabled={paused}
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
                bind:triesPerProblem
                bind:seriesIds
                {seriesOptions}
                {counterRanges}
                {counterEnabled}
                bind:lastSubmissionDays
                bind:lastOutcome
                bind:includeUnscheduled
                canReview={!!user}
                {isTest}
                {testName}
                {timeLimitSeconds}
                onClose={() => (showSettings = false)}
            />
        {/if}
    </div>
</div>
