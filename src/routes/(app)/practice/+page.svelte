<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer } from "$lib/components/problem";
    import { type TriState } from "$lib/components/toggle";
    import {
        DIFFICULTY_RANGE,
        TOPIC_LABELS,
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
    import { cn } from "$lib/utils";
    import { onMount } from "svelte";
    import SettingsPanel, {
        COUNTER_RANGE,
        type CounterEnabled,
        type CounterRanges,
    } from "./SettingsPanel.svelte";

    let { data }: { data: PageData } = $props();
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
    let loading = $state(false);
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

    let elapsedMs = $derived(
        problem && !submitted && isLatest
            ? Math.max(0, timerNow - startedAt)
            : frozenElapsedMs,
    );
    let completedAttempts = $derived(
        attempts.filter((attempt) => attempt.correct !== null),
    );
    let correctAttempts = $derived(
        completedAttempts.filter((attempt) => attempt.correct).length,
    );
    let skippedAttempts = $derived(
        attempts.filter((attempt) => attempt.skipped).length,
    );
    let accuracy = $derived(
        completedAttempts.length === 0
            ? "0%"
            : `${Math.round((correctAttempts / completedAttempts.length) * 100)}%`,
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

    function formatElapsed(ms: number) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes > 0
            ? `${minutes}:${String(seconds).padStart(2, "0")}`
            : `${seconds}s`;
    }

    function topicLabel(code: string | null | undefined) {
        if (!code) return null;
        return TOPIC_LABELS[code] ?? code;
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

    // Elapsed time for the on-screen problem: live counter for the latest
    // unanswered one, otherwise its frozen value.
    function liveElapsed() {
        return problem && !submitted && isLatest
            ? Math.max(0, Date.now() - startedAt)
            : frozenElapsedMs;
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
            });
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
            });
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

    // Load the first problem once on mount. Settings are intentionally *not* a
    // dependency here: the panel applies them to the next generated problem
    // (Skip/Next/Retry call loadProblem(), which reads currentSettings()), so
    // tweaking a control — e.g. dragging the difficulty slider — must not fire a
    // reload per change.
    onMount(() => {
        loadProblem();
    });

    $effect(() => {
        if (!problem || submitted || loading || !isLatest) return;

        const timer = setInterval(() => {
            timerNow = Date.now();
        }, 250);

        return () => clearInterval(timer);
    });
</script>

<div class="flex h-full w-full flex-col gap-1 p-0">
    <!-- Top utility bar: Settings toggle, Solved/Accuracy stats, Timer -->
    <div
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/50 py-3 px-2"
    >
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
            <Icon name="tune" class="size-[1em] shrink-0 leading-none" />
            <span class="leading-none">Settings</span>
        </Button>

        <div
            class="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground"
        >
            <span
                class="inline-flex h-8 items-center rounded-md bg-surface-container-low px-2.5"
            >
                Solved <span class="text-foreground"
                    >{completedAttempts.length}</span
                >
            </span>
            <span
                class="inline-flex h-8 items-center rounded-md bg-surface-container-low px-2.5"
            >
                Accuracy <span class="text-foreground">{accuracy}</span>
            </span>
            <span
                class="inline-flex h-8 items-center rounded-md bg-surface-container-low px-2.5"
            >
                Skipped <span class="text-foreground">{skippedAttempts}</span>
            </span>
            {#if problem}
                <span
                    class="inline-flex h-8 items-center gap-1 rounded-md bg-surface-container-low px-2.5"
                >
                    <Icon
                        name="schedule"
                        class="size-[1em] shrink-0 leading-none"
                    />
                    <span class="leading-none">{formatElapsed(elapsedMs)}</span>
                </span>
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
                <div
                    class="mx-auto flex min-h-0 w-full flex-1 flex-col px-0 bg-transparent"
                >
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
                            <span>Problem {problem.n + 1}</span>
                            {#if topicLabel(problem.topic)}
                                <span class="text-border">•</span>
                                <span>{topicLabel(problem.topic)}</span>
                            {/if}
                        </div>

                        <div
                            class="flex items-center gap-2 text-[11px] text-muted-foreground"
                        >
                            {#if currentSource === "review"}
                                <span
                                    class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
                                >
                                    <Icon
                                        name="history"
                                        class="size-[1em] shrink-0 leading-none"
                                    />
                                    Review
                                </span>
                                {#if currentProgress}
                                    <span
                                        class="inline-flex items-center gap-1"
                                    >
                                        <Icon
                                            name="visibility"
                                            class="size-[1em] shrink-0 leading-none"
                                        />
                                        Seen {currentProgress.timesSeen}×
                                    </span>
                                    {#if formatReviewDate(currentProgress.lastSubmissionAt)}
                                        <span class="text-border">•</span>
                                        <span
                                            class="inline-flex items-center gap-1"
                                            title="Last reviewed"
                                        >
                                            <Icon
                                                name="schedule"
                                                class="size-[1em] shrink-0 leading-none"
                                            />
                                            {formatReviewDate(
                                                currentProgress.lastSubmissionAt,
                                            )}
                                        </span>
                                    {/if}
                                {/if}
                            {:else}
                                <span
                                    class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 font-medium"
                                >
                                    <Icon
                                        name="auto_awesome"
                                        class="size-[1em] shrink-0 leading-none"
                                    />
                                    New
                                </span>
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
