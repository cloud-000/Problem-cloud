<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer } from "$lib/components/problem";
    import { type TriState } from "$lib/components/toggle";
    import {
        DIFFICULTY_RANGE,
        boolToTri,
        topicLabel,
        triToBool,
        type ProblemRow,
    } from "$lib/library";
    import {
        createSession,
        nextPracticeProblem,
        type PracticeAttempt,
        type PracticeMode,
        type PracticeSettings,
        type PracticeSource,
        type ProblemProgress,
    } from "$lib/trainer";
    import { recordSubmission } from "$lib/progress";
    import {
        endSession,
        fetchSession,
        fetchSessionAttempts,
        setCurrentProblem,
        updateSessionSettings,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import { cn, formatElapsed } from "$lib/utils";
    import { StatusTag } from "$lib/components/status-tag";
    import { SegmentBar } from "$lib/components/segment-bar";
    import { onMount } from "svelte";
    import SettingsPanel, {
        COUNTER_RANGE,
        type CounterEnabled,
        type CounterKey,
        type CounterRanges,
    } from "./SettingsPanel.svelte";

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
    // Time accrued before this view: the session's trigger-maintained total at
    // resume (0 for root / a fresh session). Live time is added on top below.
    let priorTotalMs = $derived(activeSession?.total_time_ms ?? 0);

    // Last settings snapshot persisted to the session, to skip redundant writes.
    let lastPersistedSettings = "";

    // Write a stored PracticeSettings snapshot back into the panel's bound state
    // (the inverse of currentSettings()), so resuming a session restores its filters.
    function applySettings(s: PracticeSettings) {
        mode = s.mode;
        topic = [...s.topic];
        difficulty = [s.difficulty[0], s.difficulty[1]];
        verifiedOnly = s.verifiedOnly;
        computational = boolToTri(s.computational);
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
            },
        ];
        restore(history.length - 1);
        loading = false;
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

    let loadToken = 0;

    let isLatest = $derived(historyIndex === history.length - 1);
    let canGoBack = $derived(historyIndex > 0);

    // Elapsed time for the on-screen problem at a given clock reading: the live
    // count for the latest unanswered one, otherwise its frozen value. `elapsedMs`
    // passes the reactive (throttled) `timerNow` to drive the ticking display;
    // `liveElapsed()` passes a fresh `Date.now()` for an exact, non-reactive
    // snapshot at event/persist time (so those paths don't subscribe to the timer).
    function elapsedAt(now: number) {
        return problem && !submitted && isLatest
            ? Math.max(0, now - startedAt)
            : frozenElapsedMs;
    }

    let elapsedMs = $derived(elapsedAt(timerNow));

    // Total time across the whole session: the prior total plus every problem in
    // this view's history, substituting the live count for the on-screen one.
    let totalElapsedMs = $derived(
        history.reduce(
            (sum, entry, i) =>
                sum + (i === historyIndex ? elapsedMs : entry.elapsedMs),
            priorTotalMs,
        ),
    );
    // The timer chip swaps between the current problem and the session total.
    let timerMode = $state<"problem" | "total">("problem");

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
            topic: [...topic],
            difficulty: [difficulty[0], difficulty[1]],
            verifiedOnly,
            computational: triToBool(computational),
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
        frozenElapsedMs = 0;
        startedAt = now;
        timerNow = now;

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

    function submitAnswer() {
        if (!problem || selectedChoice == null || submitted) return;

        const elapsed = Math.max(0, Date.now() - startedAt);
        const isCorrect = selectedChoice === problem.answer_index;

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

    // Forward steps through history; on the newest problem it acts as Skip
    // (abandon the current, unanswered problem and generate a new one).
    function goForward() {
        if (loading) return;
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

    // Resolve the session from the URL, hydrate its settings, then load the
    // first problem. Settings are intentionally *not* a reactive dependency of
    // loadProblem: the panel applies them to the next generated problem (via
    // currentSettings()), so tweaking a control must not fire a reload per change.
    onMount(async () => {
        if (!isRoot && user) {
            try {
                const s = await fetchSession(supabase, Number(sessionParam));
                if (s) {
                    activeSession = s;
                    applySettings(s.settings as unknown as PracticeSettings);
                    // Baseline so the first load doesn't re-persist the snapshot.
                    lastPersistedSettings = JSON.stringify(currentSettings());

                    // Seed draw-state + the live counts from prior work so the
                    // queue doesn't repeat and the indicators stay continuous.
                    const prior = await fetchSessionAttempts(supabase, s.id);
                    for (const a of prior) session.shownIds.add(a.problemId);
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
        if (!problem || submitted || loading || !isLatest) return;

        const timer = setInterval(() => {
            timerNow = Date.now();
        }, 250);

        return () => clearInterval(timer);
    });

    // While a problem is in progress within a session, periodically persist its
    // elapsed time so a reload/resume continues from roughly where it was.
    $effect(() => {
        const sid = currentSessionId;
        if (sid == null) return;
        if (!problem || submitted || loading || !isLatest) return;
        const pid = problem.id;

        const timer = setInterval(() => {
            setCurrentProblem(supabase, sid, pid, liveElapsed()).catch((e) =>
                console.error("Failed to persist session progress:", e),
            );
        }, 5000);

        return () => clearInterval(timer);
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

<div class="flex h-full w-full flex-col gap-1">
    <!-- Top utility bar: back to hub, session context, Settings, stats, timer -->
    <div
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/50 py-3 px-2 select-none"
    >
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
            >
                <Icon name="tune" class={iconCls} />
            </Button>

            {#if activeSession}
                <div class="flex flex-row gap-1 opacity-50">
                    <span>{activeSession.name}</span>
                </div>
            {/if}
        </div>

        <div
            class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground"
        >
            {@render statChip(correctAttempts, "var(--color-correct)")}
            {@render statChip(incorrectAttempts, "var(--color-destructive)")}
            {@render statChip(skippedAttempts, "var(--color-unsure)")}
            <SegmentBar
                class="w-36 h-2"
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
            {#if problem}
                {@const isTotal = timerMode === "total"}
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
                >
                    <Icon name={isTotal ? "timelapse" : "schedule"} class={iconCls} />
                    <span class="leading-none">
                        {formatElapsed(isTotal ? totalElapsedMs : elapsedMs)}
                    </span>
                </button>
            {/if}
        </div>
    </div>

    <!-- Main Content Area: Problem + Collapsible Settings Panel -->
    <div
        class="flex flex-1 flex-col lg:flex-row gap-1 items-stretch justify-center w-full min-h-0 h-full"
    >
        <main
            class="flex-1 w-full min-w-0 flex flex-col justify-between pt-2 h-full"
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
                        Generating problem...
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
                            Could not load a problem
                        </h2>
                        <p class="text-xs text-muted-foreground">{error}</p>
                    </div>
                    <Button size="sm" onclick={() => loadProblem()}
                        >Retry</Button
                    >
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
                    <!-- Metadata row: source/series/topic on the left, review status on the right -->
                    <div
                        class="mb-2 flex items-center justify-between gap-3 px-4 select-none bg-transparent"
                    >
                        <div
                            class="flex items-center gap-2 text-xs font-semibold opacity-50 tracking-wider uppercase text-muted-foreground"
                        >
                            {#if problem.tests?.name}
                                <span>{problem.tests.name}</span>
                                <span class="text-border">•</span>
                            {/if}
                            <span>#{problem.n + 1}</span>
                            {#if topicName}
                                <span class="text-border">•</span>
                                <span>{topicName}</span>
                            {/if}
                        </div>

                        <div
                            class="flex items-center gap-2 text-[11px] text-muted-foreground"
                        >
                            {#if currentSource === "review"}
                                <StatusTag status="review" size="sm" />
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
                                        <span class="text-border">•</span>
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
                        </div>
                    </div>

                    <!-- Problem statement and choices: Centered vertically using flex-grow -->
                    <div
                        class="flex-1 flex flex-col justify-center items-center gap-4 w-full min-h-0 overflow-y-auto py-4 px-6"
                    >
                        <div
                            class="flex h-full min-h-fit w-full items-center justify-center"
                        >
                            <MathStatement
                                text={problem.statement ?? ""}
                                class="font-serif text-lg md:text-xl text-foreground leading-relaxed text-left w-full max-w-4xl py-2"
                            />
                        </div>
                        <div class="w-full">
                            <ProblemAnswer
                                choices={problem.choices}
                                answerIndex={problem.answer_index}
                                bind:answer
                                bind:selectedChoice
                                showAnswerState={submitted}
                                disabled={submitted || !isLatest}
                            />
                        </div>
                    </div>

                    <!-- Footer with ghosted Flag/Skip and primary Next/Submit buttons -->
                    <footer
                        class="sticky bottom-0 z-10 px-2 py-1 flex items-center justify-between w-full border-t border-border/50"
                    >
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

                            <Button
                                variant="ghost"
                                disabled={isLatest && submitted}
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

                            <Button
                                variant="ghost"
                                onclick={toggleFlag}
                                class={cn(
                                    "font-normal text-xs px-3 py-1.5 h-auto gap-1 [&_svg]:size-3.5",
                                    flagged
                                        ? "text-unsure hover:text-unsure/80"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                <Icon name="flag" fill={flagged} />
                                {flagged ? "Flagged" : "Flag"}
                            </Button>
                        </div>

                        <div>
                            {#if !isLatest}
                                <Button
                                    variant="outline"
                                    onclick={jumpToLatest}
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
                                    disabled={selectedChoice == null}
                                    onclick={submitAnswer}
                                    class="bg-primary/90 text-primary-foreground hover:bg-primary disabled:opacity-40 text-xs font-semibold px-4 py-2 h-9 shadow-sm rounded-lg"
                                >
                                    Submit
                                </Button>
                            {/if}
                        </div>
                    </footer>
                </div>
            {/if}
        </main>

        <!-- Sidebar settings panel -->
        {#if showSettings}
            <SettingsPanel
                bind:mode
                bind:topic
                bind:difficulty
                bind:verifiedOnly
                bind:computational
                {counterRanges}
                {counterEnabled}
                bind:lastSubmissionDays
                bind:lastOutcome
                bind:includeUnscheduled
                canReview={!!user}
                onClose={() => (showSettings = false)}
            />
        {/if}
    </div>
</div>
