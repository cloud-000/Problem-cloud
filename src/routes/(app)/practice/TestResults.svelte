<script lang="ts">
    import { onMount } from "svelte";
    import type { Attachment } from "svelte/attachments";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { StatusTag } from "$lib/components/status-tag";
    import { ProblemReview, ProblemAnswer, ProblemSolution } from "$lib/components/problem";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemOrganization } from "$lib/components/problem-organization";
    import { CoachContextRegister, CoachInline } from "$lib/components/coach";
    import { ProblemGrid, type ProblemGridCell } from "$lib/components/problem-grid";
    import { SegmentBar } from "$lib/components/segment-bar";
    import { Graph } from "$lib/components/graph";
    import { formatElapsed, isMultipleChoice, cn, formatProblemText } from "$lib/utils";
    import { aopsProblemUrl, topicLabel } from "$lib/library";
    import { coach } from "$lib/state/coach.svelte";
    import { shell } from "$lib/state/shell.svelte";
    import { anchorFor } from "$lib/ai/session/anchor";
    import { problemContextLayer } from "$lib/ai/context/surfaces";
    import { PROBLEM_QUICK_ACTIONS } from "$lib/ai/quick-actions";
    import type { PracticeHistoryEntry } from "./practice-state";
    import type { TestResultSummary } from "./test-state";
    import { submissionOutcome } from "$lib/problem-response";

    let {
        history,
        summary,
        elapsedMs,
        sessionId = null,
    }: {
        history: PracticeHistoryEntry[];
        summary: TestResultSummary;
        elapsedMs: number;
        sessionId?: number | null;
    } = $props();

    let activeProblemIndex = $state<number | null>(null);
    let userExpandedPreference = $state<boolean | null>(null);
    let isSmallScreen = $state(false);

    onMount(() => {
        const mq = window.matchMedia("(max-width: 639px)");
        isSmallScreen = mq.matches;
        const handler = (e: MediaQueryListEvent) => {
            isSmallScreen = e.matches;
        };
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    });

    let isExpanded = $derived(
        userExpandedPreference !== null
            ? userExpandedPreference
            : !isSmallScreen,
    );

    function outcomeFor(entry: PracticeHistoryEntry) {
        const mcq = isMultipleChoice(entry.problem.choices);
        const skipped =
            entry.skipped ??
            (mcq
                ? entry.selectedChoice == null
                : !entry.answer || !entry.answer.trim());
        return submissionOutcome({ skipped, is_correct: entry.correct });
    }

    let cells = $derived<ProblemGridCell[]>(
        history.map((entry, index) => ({
            label: entry.problem.n + 1,
            state: outcomeFor(entry),
            flagged: entry.flagged,
            current: activeProblemIndex === index,
        })),
    );

    let focusedIndex = $state(0);
    let reviewOpen = $state(false);
    let focusedEntry = $derived(history[focusedIndex]);
    let focusedOutcome = $derived(focusedEntry ? outcomeFor(focusedEntry) : null);

    let coachComposer = $state<HTMLTextAreaElement | null>(null);
    let coachExpanded = $derived(coach.enabled && coach.messages.length > 0);

    let draftAnswer = $state("");
    let draftChoice = $state<number | null>(null);
    let draftEliminated = $state<number[]>([]);

    $effect.pre(() => {
        draftAnswer = focusedEntry?.answer ?? "";
        draftChoice = focusedEntry?.selectedChoice ?? null;
        draftEliminated = [];
    });

    let aopsProblemHref = $derived(
        focusedEntry ? aopsProblemUrl(focusedEntry.problem.aops_id) : null,
    );
    let topicName = $derived(
        focusedEntry ? topicLabel(focusedEntry.problem.topic) : null,
    );

    const portal: Attachment<HTMLDivElement> = (node) => {
        document.body.appendChild(node);
        return () => node.remove();
    };

    $effect(() => {
        if (reviewOpen) {
            const originalOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            const releaseNav = shell.suppressMobileNav();
            return () => {
                document.body.style.overflow = originalOverflow;
                releaseNav();
            };
        }
    });

    function openProblem(index: number) {
        showProblem(index);
        reviewOpen = true;
    }

    function closeReview() {
        reviewOpen = false;
    }

    function showProblem(index: number) {
        if (index < 0 || index >= history.length) return;
        focusedIndex = index;
        const entry = history[index];
        if (entry && coach.enabled) {
            void coach.openWorkThread(anchorFor(entry.problem, sessionId), {
                submitted: true,
                skipped: Boolean(entry.skipped),
            });
            void coach.initialize();
        }
    }

    function handleReviewKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeReview();
            return;
        }
        const target = event.target as HTMLElement | null;
        const isInput =
            target &&
            (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable);
        if (!isInput) {
            if (event.key === "ArrowLeft" && focusedIndex > 0) {
                event.preventDefault();
                showProblem(focusedIndex - 1);
            } else if (
                event.key === "ArrowRight" &&
                focusedIndex < history.length - 1
            ) {
                event.preventDefault();
                showProblem(focusedIndex + 1);
            }
        }
    }

    // Graph states
    let graphHoverIndex = $state<number | null>(null);

    let processedHistory = $derived(
        history.map((entry) => {
            const mcq = isMultipleChoice(entry.problem.choices);
            const skipped =
                entry.skipped ??
                (mcq ? entry.selectedChoice == null : !entry.answer.trim());
            const state = submissionOutcome({
                skipped,
                is_correct: entry.correct,
            });
            const seconds = entry.elapsedMs / 1000;
            return {
                entry,
                skipped,
                correct: entry.correct,
                state,
                seconds,
            };
        }),
    );

    let yMax = $derived(
        Math.max(...processedHistory.map((h) => h.seconds), 30),
    );

    let activeEntry = $derived(
        graphHoverIndex !== null ? processedHistory[graphHoverIndex] : null,
    );

    let labelInterval = $derived.by(() => {
        const n = history.length;
        if (n <= 15) return 1;
        if (n <= 30) return 2;
        return 5;
    });

    function scrollToProblem(index: number) {
        activeProblemIndex = index;
        const target = document.getElementById(`test-review-${index}`);
        const scrollContainer = target?.closest<HTMLElement>(
            "[data-test-results-scroll]",
        );
        const summaryPanel = scrollContainer?.querySelector<HTMLElement>(
            "[data-test-results-summary]",
        );
        if (!target || !scrollContainer || !summaryPanel) return;
        const targetTop = target.getBoundingClientRect().top;
        const containerTop = scrollContainer.getBoundingClientRect().top;
        scrollContainer.scrollTo({
            top:
                scrollContainer.scrollTop +
                targetTop -
                containerTop -
                summaryPanel.offsetHeight -
                16,
            behavior: "smooth",
        });
    }

    let scrollRafId: number | null = null;
    function handleScroll(e: Event) {
        if (scrollRafId !== null) return;
        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            const container = e.currentTarget as HTMLElement;
            if (!container) return;
            const summaryPanel = container.querySelector<HTMLElement>(
                "[data-test-results-summary]",
            );
            const threshold = (summaryPanel ? summaryPanel.offsetHeight : 0) + 32;
            const containerTop = container.getBoundingClientRect().top;

            for (let i = 0; i < history.length; i++) {
                const el = document.getElementById(`test-review-${i}`);
                if (!el) continue;
                const rect = el.getBoundingClientRect();
                const bottomRelativeToContainer = rect.bottom - containerTop;
                if (bottomRelativeToContainer > threshold) {
                    activeProblemIndex = i;
                    break;
                }
            }
        });
    }
</script>

{#snippet statChip(value: number, color: string, label: string)}
    <span
        class="inline-flex h-6 sm:h-7 min-w-6 sm:min-w-7 items-center justify-center rounded-md bg-surface-container-low px-1.5 sm:px-2 font-mono text-xs tabular-nums font-semibold"
        style:color
        title={`${value} ${label}`}
    >
        {value}
    </span>
{/snippet}

<div
    data-test-results-scroll
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto px-3 sm:px-6 pb-10"
>
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 sm:gap-6 pt-2 sm:pt-4">
        <div
            data-test-results-summary
            class="sticky top-0 z-20 flex flex-col gap-2.5 sm:gap-3 rounded-xl border border-border/60 bg-surface-container-lowest/95 backdrop-blur-md p-3.5 sm:p-5 shadow-sm transition-all"
        >
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <Icon name="task_alt" class="text-primary shrink-0" fontsize={20} />
                    <h2 class="text-base sm:text-lg font-semibold truncate">Test complete</h2>
                </div>
                <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <div
                        class="flex items-center gap-1 rounded-md bg-surface-container-low px-2 py-0.5 text-xs font-mono text-muted-foreground"
                        title={`Total time: ${formatElapsed(elapsedMs)}`}
                    >
                        <Icon name="timer" fontsize={14} class="text-muted-foreground" />
                        <span>{formatElapsed(elapsedMs)}</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onclick={() => (userExpandedPreference = !isExpanded)}
                        aria-label={isExpanded ? "Collapse to compact strip" : "Expand to full grid"}
                        title={isExpanded ? "Collapse to compact strip" : "Expand to full grid"}
                        class="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                        <Icon name={isExpanded ? "expand_less" : "expand_more"} fontsize={18} />
                    </Button>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground">
                {@render statChip(summary.correct, "var(--color-correct)", "correct")}
                {@render statChip(summary.incorrect, "var(--color-destructive)", "incorrect")}
                {@render statChip(summary.ungraded, "var(--color-muted-foreground)", "ungraded")}
                {@render statChip(summary.skipped, "var(--color-unsure)", "skipped")}
                <span class="inline sm:hidden ml-1 text-muted-foreground/90 font-medium">
                    {summary.correct}/{history.length} score
                </span>
            </div>

            <SegmentBar
                class="h-1.5 sm:h-2 min-w-0"
                segments={[
                    { value: summary.correct, color: "var(--color-correct)", label: "Correct" },
                    { value: summary.incorrect, color: "var(--color-destructive)", label: "Incorrect" },
                    { value: summary.ungraded, color: "var(--color-muted-foreground)", label: "Ungraded" },
                    { value: summary.skipped, color: "var(--color-unsure)", label: "Skipped" },
                ]}
            />

            <ProblemGrid
                class="mt-0.5"
                variant={isExpanded ? "grid" : "strip"}
                {cells}
                onSelect={scrollToProblem}
            />
        </div>
        
        <!-- Time per Problem Graph Card -->
        {#if history.length > 0}
            <div class="rounded-xl border border-border/60 bg-surface-container-lowest p-3.5 sm:p-5 shadow-sm flex flex-col gap-2.5 sm:gap-3">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                    <div class="flex items-center gap-2">
                        <Icon name="bar_chart" class="text-primary-foreground" fontsize={20} />
                        <h3 class="font-semibold text-foreground text-sm">Time per Problem</h3>
                    </div>
                    <div class="text-xs font-mono text-muted-foreground min-h-5 flex items-center">
                        {#if activeEntry}
                            <span class="font-semibold text-foreground mr-1.5">Problem {activeEntry.entry.problem.n + 1}</span>
                            <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold mr-1.5 uppercase tracking-wide" 
                                  class:bg-correct-container={activeEntry.state === 'correct'}
                                  class:text-on-correct-container={activeEntry.state === 'correct'}
                                  class:bg-error-container={activeEntry.state === 'incorrect'}
                                  class:text-on-error-container={activeEntry.state === 'incorrect'}
                                  class:bg-unsure-container={activeEntry.state === 'skipped'}
                                  class:text-on-unsure-container={activeEntry.state === 'skipped'}
                                  class:bg-surface-container={activeEntry.state === 'ungraded'}
                                  class:text-muted-foreground={activeEntry.state === 'ungraded'}>
                                {activeEntry.state}
                            </span>
                            <span class="font-semibold text-foreground flex items-center gap-0.5">
                                <Icon name="timer" fontsize={14} class="text-muted-foreground" />
                                {formatElapsed(activeEntry.entry.elapsedMs)}
                            </span>
                        {:else}
                            <span class="text-muted-foreground/85 italic flex items-center gap-1">
                                <Icon name="info" fontsize={14} />
                                Hover to inspect · Click to scroll
                            </span>
                        {/if}
                    </div>
                </div>

                <div class="bg-surface-container-low/40 border border-border/40 rounded-lg p-3 sm:p-4">
                    <Graph
                        xCount={processedHistory.length}
                        yMin={0}
                        yMax={yMax}
                        height={160}
                        padding={{ t: 10, r: 16, b: 20, l: 44 }}
                        bind:hover={graphHoverIndex}
                        formatY={(v) => formatElapsed(v * 1000)}
                        class="cursor-pointer"
                        onclick={() => {
                            if (graphHoverIndex !== null) scrollToProblem(graphHoverIndex);
                        }}
                    >
                        {#snippet children(geo)}
                            {#each processedHistory as item, i (item.entry.problem.id)}
                                {@const colWidth = geo.n === 1 ? geo.plotW : geo.plotW / (geo.n - 1)}
                                {@const barWidth = Math.min(28, Math.max(6, colWidth * 0.55))}
                                {@const cx = geo.x(i)}
                                {@const x = cx - barWidth / 2}
                                {@const y = geo.y(item.seconds)}
                                {@const h = geo.y(0) - y}
                                {@const color = item.state === "correct"
                                    ? "var(--color-correct)"
                                    : item.state === "incorrect"
                                      ? "var(--color-destructive)"
                                      : item.state === "ungraded"
                                        ? "var(--color-muted-foreground)"
                                        : "var(--color-unsure)"}
                                
                                <!-- Highlight column background on hover -->
                                {#if graphHoverIndex === i}
                                    <rect
                                        x={cx - colWidth / 2}
                                        y={geo.y(yMax)}
                                        width={colWidth}
                                        height={geo.y(0) - geo.y(yMax)}
                                        fill="var(--color-primary-foreground)"
                                        opacity="0.05"
                                        class="pointer-events-none"
                                    />
                                {/if}
                                
                                <!-- Draw bar -->
                                <rect
                                    {x}
                                    {y}
                                    width={barWidth}
                                    height={Math.max(h, 2)}
                                    rx="3"
                                    fill={color}
                                    class="transition-opacity duration-150 cursor-pointer"
                                    opacity={graphHoverIndex === null || graphHoverIndex === i ? 1.0 : 0.45}
                                />
                                
                                <!-- X Axis label -->
                                {#if i % labelInterval === 0}
                                    <text
                                        x={cx}
                                        y={geo.height - 4}
                                        text-anchor="middle"
                                        fill="var(--color-muted-foreground)"
                                        class="font-mono text-[9px] sm:text-[10px]"
                                    >
                                        {item.entry.problem.n + 1}
                                    </text>
                                {/if}
                            {/each}
                        {/snippet}
                    </Graph>
                </div>
            </div>
        {/if}

        <div class="flex flex-col gap-3">
            {#each history as entry, index (entry.problem.id)}
                <div id={`test-review-${index}`} class="scroll-mt-4">
                    <ProblemReview
                        {entry}
                        elapsedMs={entry.elapsedMs}
                        showOrganization
                    >
                        {#snippet actions()}
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onclick={() => openProblem(index)}
                                aria-label={`Open problem ${entry.problem.n + 1} in fullscreen review`}
                                title="Open in fullscreen review"
                                class="text-muted-foreground hover:text-foreground"
                            >
                                <Icon name="open_in_full" />
                            </Button>
                        {/snippet}
                    </ProblemReview>
                </div>
            {/each}
        </div>
        <div class="flex justify-center pt-2">
            <Button variant="outline" href="/practice">Back to sessions</Button>
        </div>
    </div>
</div>

{#if reviewOpen && focusedEntry}
    <div
        {@attach portal}
        class="fixed inset-0 z-80 flex flex-col bg-background pb-[env(safe-area-inset-bottom,0px)]"
        role="dialog"
        aria-modal="true"
        aria-label={`Problem ${focusedEntry.problem.n + 1} review`}
        tabindex="-1"
        onkeydown={handleReviewKeydown}
    >
        <!-- Header -->
        <header
            class="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface-container-low/95 px-3 pb-2 pt-[max(0.5rem,var(--safe-area-top))] sm:px-6 sm:py-2 backdrop-blur-xs gap-2"
        >
            <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <Button
                    variant="ghost"
                    size="sm"
                    class="gap-1 sm:gap-1.5 -ml-1 text-muted-foreground hover:text-foreground shrink-0"
                    onclick={closeReview}
                    aria-label="Back to test results"
                >
                    <Icon name="arrow_back" />
                    <span class="font-medium text-xs sm:text-sm hidden sm:inline">Back to Results</span>
                    <span class="font-medium text-xs sm:hidden">Back</span>
                </Button>

                <div class="hidden sm:block h-4 w-px bg-border/60 shrink-0"></div>

                <span
                    class="inline-flex shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-container-lowest px-1.5 py-0.5 sm:px-2 font-mono type-caption font-semibold tabular-nums text-foreground shadow-xs"
                    aria-label={`Problem ${focusedEntry.problem.n + 1}`}
                >
                    #{focusedEntry.problem.n + 1}
                </span>

                {#if focusedOutcome}
                    <StatusTag status={focusedOutcome} size="sm" />
                {/if}

                {#if focusedEntry.flagged}
                    <Icon name="flag" class="size-[1.1em] text-unsure shrink-0" fill />
                {/if}

                {#if focusedEntry.elapsedMs != null}
                    <span
                        class="hidden sm:inline-flex shrink-0 items-center gap-1 font-mono tabular-nums text-muted-foreground type-caption"
                        title="Time spent on this problem"
                    >
                        <Icon name="schedule" class="size-[1em]" />
                        {formatElapsed(focusedEntry.elapsedMs)}
                    </span>
                {/if}

                {#if focusedEntry.problem.tests?.name}
                    <span class="hidden md:inline text-xs text-muted-foreground truncate">
                        · {focusedEntry.problem.tests.name}
                    </span>
                {/if}

                {#if topicName}
                    <span
                        class="hidden sm:inline-flex items-center rounded-full border border-border/60 bg-surface-container-lowest px-2 py-0.5 type-caption text-muted-foreground"
                    >
                        {topicName}
                    </span>
                {/if}

                {#if aopsProblemHref}
                    <Button
                        href={aopsProblemHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="ghost"
                        size="xs"
                        class="hidden md:inline-flex gap-1 px-2 text-muted-foreground hover:text-foreground"
                        title="Open problem discussion on Art of Problem Solving"
                    >
                        <Icon name="forum" class="size-3.5" />
                        <span class="text-xs">Discuss</span>
                    </Button>
                {/if}
            </div>

            <div class="flex items-center gap-1 sm:gap-2 shrink-0">
                <span class="hidden sm:inline text-xs font-mono tabular-nums text-muted-foreground mr-1">
                    {focusedIndex + 1} of {history.length}
                </span>

                <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={focusedIndex === 0}
                    onclick={() => showProblem(focusedIndex - 1)}
                    aria-label="Previous problem"
                    title="Previous problem (←)"
                >
                    <Icon name="chevron_left" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={focusedIndex === history.length - 1}
                    onclick={() => showProblem(focusedIndex + 1)}
                    aria-label="Next problem"
                    title="Next problem (→)"
                >
                    <Icon name="chevron_right" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={closeReview}
                    aria-label="Close review"
                    title="Close review (Esc)"
                    class="rounded-full text-muted-foreground hover:text-foreground ml-1"
                >
                    <Icon name="close" />
                </Button>
            </div>
        </header>

        <!-- Main Body -->
        <CoachContextRegister
            {...problemContextLayer({
                ownerId: "test-results.focused",
                source: "route",
                problem: focusedEntry.problem,
                policy: "coaching",
            })}
        />

        <div class="relative flex-1 flex flex-col min-h-0 w-full overflow-hidden">
            <!-- Problem Statement & Solutions Shelf (Unboxed, Dynamic Height) -->
            <div
                class={cn(
                    "flex w-full flex-col overflow-y-auto px-4 sm:px-6 transition-all duration-300 ease-out",
                    coachExpanded
                        ? "flex-1 min-h-[30%] border-b border-border/60"
                        : "flex-1 min-h-0",
                )}
            >
                <div class="mx-auto flex w-full max-w-[48rem] flex-col gap-6 py-6">
                    <!-- Problem Statement -->
                    <MathStatement
                        text={formatProblemText(
                            focusedEntry.problem.statement ?? "",
                            isMultipleChoice(focusedEntry.problem.choices),
                        )}
                        class="type-problem w-full text-left font-serif text-foreground leading-relaxed"
                    />

                    <!-- Graded Response / Choices -->
                    <div class="flex flex-col gap-2.5 border-t border-border/60 pt-4" aria-label="Your response">
                        <ProblemAnswer
                            choices={focusedEntry.problem.choices}
                            answerIndex={focusedEntry.problem.answer_index}
                            responseKind={focusedEntry.problem.response_kind}
                            answerStatus={focusedEntry.problem.answer_status}
                            bind:answer={draftAnswer}
                            bind:selectedChoice={draftChoice}
                            bind:eliminated={draftEliminated}
                            showAnswerState={true}
                            disabled={false}
                            isInstantFeedback={true}
                            gradedResponse={{
                                selectedChoice: focusedEntry.selectedChoice,
                                answer: focusedEntry.answer ?? "",
                            }}
                        />
                    </div>

                    <!-- Organization (Familiarity / Mastery) -->
                    <div class="border-t border-border/60 pt-4">
                        <ProblemOrganization
                            problemId={focusedEntry.problem.id}
                            mastery={focusedEntry.progress?.mastery ?? null}
                            engagement={focusedEntry.progress?.engagement ?? null}
                            promptPresentation="persistent"
                            onchange={(state) => {
                                if (focusedEntry.progress) {
                                    focusedEntry.progress.mastery = state.mastery;
                                    focusedEntry.progress.engagement = state.engagement;
                                }
                            }}
                        />
                    </div>

                    <!-- Worked Solutions -->
                    {#if focusedEntry.problem.official_solutions && focusedEntry.problem.official_solutions.length > 0}
                        <div class="border-t border-border/60 pt-4">
                            <ProblemSolution
                                solutions={focusedEntry.problem.official_solutions}
                                defaultOpen={focusedEntry.correct === false}
                            />
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Integrated CoachInline -->
            {#if coach.enabled}
                <div
                    class={cn(
                        "flex w-full flex-col transition-all duration-300 ease-out",
                        coachExpanded
                            ? "flex-1 min-h-[30%] overflow-hidden"
                            : "shrink-0 justify-end",
                    )}
                >
                    <CoachInline
                        compact={!coachExpanded}
                        quickActions={PROBLEM_QUICK_ACTIONS}
                        bind:composerRef={coachComposer}
                    />
                </div>
            {/if}
        </div>
    </div>
{/if}
