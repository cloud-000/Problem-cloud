<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ProblemOrganization } from "$lib/components/problem-organization";
    import { fly } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import {
        reviewIsDue,
        statusForReview,
        type SeriesReviewProblem,
        type SeriesReviewStatus,
        type SeriesReviewTest,
    } from "$lib/series-review";

    interface Props {
        selected: { test: SeriesReviewTest; problem: SeriesReviewProblem };
        openingProblemId: number | null;
        onOpenProblem: (problemId: number) => void;
        onClose: () => void;
        position?: { x: number; y: number };
    }

    let {
        selected,
        openingProblemId,
        onOpenProblem,
        onClose,
        position = $bindable({ x: 0, y: 0 }),
    }: Props = $props();

    let progress = $derived(selected.problem.progress);

    const activityMeta: Record<
        SeriesReviewStatus,
        { label: string; icon: string }
    > = {
        unseen: { label: "Unseen", icon: "" },
        skipped_only: { label: "Skipped only", icon: "remove" },
        attempted: { label: "Attempted", icon: "close" },
        solved: { label: "Solved", icon: "check" },
    };

    function detailDate(value: string | null | undefined) {
        if (!value) return "—";
        return new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        }).format(new Date(value));
    }

    // Draggable functionality
    let cardElement = $state<HTMLDivElement | null>(null);
    let isDragging = $state(false);
    let dragStart = { x: 0, y: 0 };
    let initialPosition = { x: 0, y: 0 };
    let limits = {
        minX: -Infinity,
        maxX: Infinity,
        minY: -Infinity,
        maxY: Infinity,
    };

    function startDrag(e: MouseEvent | TouchEvent) {
        const target = e.target as HTMLElement;
        // Don't drag if clicking buttons, select menus, input elements, or interactive controls
        if (
            target.closest("button") ||
            target.closest("details") ||
            target.closest("a") ||
            target.closest("select") ||
            target.closest("input")
        ) {
            return;
        }

        isDragging = true;
        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
        const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

        dragStart = { x: clientX, y: clientY };
        initialPosition = { x: position.x, y: position.y };

        if (cardElement) {
            const rect = cardElement.getBoundingClientRect();
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;

            const layoutLeft = rect.left - position.x;
            const layoutTop = rect.top - position.y;

            limits = {
                minX: 8 - layoutLeft,
                maxX: winWidth - 8 - layoutLeft - rect.width,
                minY: 8 - layoutTop,
                maxY: winHeight - 8 - layoutTop - rect.height,
            };
        }

        if (e.cancelable) {
            e.preventDefault();
        }

        window.addEventListener("mousemove", handleDrag);
        window.addEventListener("touchmove", handleDrag, { passive: false });
        window.addEventListener("mouseup", endDrag);
        window.addEventListener("touchend", endDrag);
    }

    function handleDrag(e: MouseEvent | TouchEvent) {
        if (!isDragging) return;

        const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
        const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - dragStart.x;
        const deltaY = clientY - dragStart.y;

        let newX = initialPosition.x + deltaX;
        let newY = initialPosition.y + deltaY;

        newX = Math.max(limits.minX, Math.min(limits.maxX, newX));
        newY = Math.max(limits.minY, Math.min(limits.maxY, newY));

        position = { x: newX, y: newY };
    }

    function endDrag() {
        isDragging = false;
        window.removeEventListener("mousemove", handleDrag);
        window.removeEventListener("touchmove", handleDrag);
        window.removeEventListener("mouseup", endDrag);
        window.removeEventListener("touchend", endDrag);
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={cardElement}
    class="fixed bottom-6 right-6 md:right-8 z-40 w-[calc(100%-3rem)] sm:w-[480px] rounded-2xl border border-primary/20 bg-surface-container-lowest/95 backdrop-blur-md p-5 shadow-2xl transition-colors duration-200 select-none touch-none"
    style="transform: translate({position.x}px, {position.y}px);"
    onmousedown={startDrag}
    ontouchstart={startDrag}
    transition:fly={{ y: 24, duration: 220, easing: cubicOut }}
    aria-live="polite"
>
    <!-- Drag Handle Bar Indicator -->
    <div
        class="mx-auto w-12 h-1.5 rounded-full bg-border/80 mb-3 cursor-grab active:cursor-grabbing"
        aria-hidden="true"
    ></div>

    <!-- Header -->
    <div class="flex items-center justify-between">
        <div
            class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
            <Icon
                name="ads_click"
                fontsize="1rem"
                class="text-primary-foreground"
            />
            <span>Selected problem</span>
        </div>
        <Button
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground hover:text-foreground rounded-full -mr-1.5 -mt-1.5"
            onclick={onClose}
            aria-label="Close details"
        >
            <Icon name="close" />
        </Button>
    </div>

    <div class="mt-3 min-w-0">
        <h4
            class="truncate font-semibold text-base text-foreground leading-snug"
        >
            {selected.test.name}
        </h4>
        <p class="text-xs text-muted-foreground mt-0.5">
            Problem {selected.problem.n + 1} · {activityMeta[
                statusForReview(progress)
            ].label}
            {#if reviewIsDue(progress)}
                · <span class="text-primary-foreground font-semibold"
                    >Review due</span
                >
            {/if}
        </p>
    </div>

    <!-- Stats Grid -->
    <div
        class="grid grid-cols-3 gap-3 text-center my-4 bg-surface-container-low/50 rounded-xl p-3 border border-border/40"
    >
        <div>
            <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Correct
            </div>
            <div class="mt-1 font-mono text-sm font-semibold text-foreground">
                {progress?.times_correct ?? 0}/{progress?.times_reviewed ?? 0}
            </div>
        </div>
        <div>
            <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Last result
            </div>
            <div class="mt-1 text-sm font-semibold text-foreground">
                {progress?.last_correct == null
                    ? "—"
                    : progress.last_correct
                      ? "Correct"
                      : "Incorrect"}
            </div>
        </div>
        <div>
            <div
                class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Next review
            </div>
            <div class="mt-1 text-sm font-semibold text-foreground">
                {detailDate(progress?.next_review_at)}
            </div>
        </div>
    </div>

    <!-- Actions Footer -->
    <div
        class="flex items-center justify-between gap-3 mt-4 pt-2 border-t border-border/40"
    >
        <div class="flex items-center gap-2">
            <span
                class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                >Set plan</span
            >
            <ProblemOrganization
                problemId={selected.problem.id}
                mastery={progress?.mastery ?? null}
                engagement={progress?.engagement ?? null}
                onchange={(state) => {
                    if (selected?.problem.progress) {
                        selected.problem.progress.mastery = state.mastery;
                        selected.problem.progress.engagement = state.engagement;
                    }
                }}
            />
        </div>
        <Button
            size="sm"
            class="gap-1.5 shadow-sm"
            disabled={openingProblemId === selected.problem.id}
            onclick={() => onOpenProblem(selected!.problem.id)}
        >
            <Icon
                name={openingProblemId === selected.problem.id
                    ? "progress_activity"
                    : "open_in_new"}
                class={openingProblemId === selected.problem.id
                    ? "animate-spin"
                    : undefined}
                fontsize="1rem"
            />
        </Button>
    </div>
</div>
