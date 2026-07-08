<script lang="ts">
    import { Switch } from "$lib/components/toggle";
    import { Icon } from "$lib/components/icon";
    import {
        topicLabel,
        glickoMatchPreview,
        playerRatingIsProvisional,
        ratingIsProvisional,
        type ProblemRow,
        type PlayerRating,
        type ProblemRating,
    } from "$lib/library";

    interface Props {
        problem: ProblemRow;
        playerRating: PlayerRating | null;
        problemRating: ProblemRating | null;
        showRawLatex: boolean;
        onClose: () => void;
    }

    let {
        problem,
        playerRating,
        problemRating,
        showRawLatex = $bindable(false),
        onClose,
    }: Props = $props();

    // Pre-submission Glicko preview for this specific match — only computable
    // once both sides have a rating row (they appear with their first graded
    // submission). Reruns whenever either rating changes.
    let match = $derived(
        playerRating && problemRating
            ? glickoMatchPreview(playerRating, problemRating)
            : null,
    );

    const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

    let copied = $state(false);

    async function copyId() {
        try {
            await navigator.clipboard.writeText(String(problem.id));
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        } catch (err) {
            console.error("Failed to copy problem ID:", err);
        }
    }

    let topicName = $derived(problem.topic ? topicLabel(problem.topic) : "N/A");
</script>

<div
    class="w-full max-w-4xl bg-surface-container-low border border-border rounded-xl p-4 shadow-sm flex flex-col gap-3 transition-all select-none"
>
    <!-- Title and Actions -->
    <div
        class="flex items-center justify-between border-b border-border/50 pb-2"
    >
        <div
            class="flex items-center gap-2 font-medium text-foreground text-xs uppercase tracking-wider"
        >
            <Icon name="bug_report" class="text-primary-foreground" />
            <span>Trainer Debug Info</span>
        </div>
        <button
            onclick={onClose}
            class="text-muted-foreground hover:text-foreground p-1 rounded transition-colors cursor-pointer flex items-center justify-center"
            title="Close Debug Mode"
        >
            <Icon name="close" class="size-4" />
        </button>
    </div>

    <!-- Metadata Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
        <div class="flex flex-col gap-2">
            <!-- Problem ID with Copy Action -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono">Problem ID</span>
                <div class="flex items-center gap-1.5 min-w-0">
                    <span
                        class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 truncate max-w-[180px] md:max-w-[240px] select-all font-semibold"
                        title={String(problem.id)}
                    >
                        {problem.id}
                    </span>
                    <button
                        onclick={copyId}
                        class="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center justify-center"
                        title="Copy Problem ID"
                    >
                        <Icon
                            name={copied ? "check" : "content_copy"}
                            class={copied ? "text-correct" : ""}
                            fontsize={14}
                        />
                    </button>
                </div>
            </div>

            <!-- Test ID / Name -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono"
                    >Test ID (Name)</span
                >
                <span
                    class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                >
                    {problem.test_id ?? "N/A"}
                    {#if problem.tests?.name}({problem.tests.name}){/if}
                </span>
            </div>

            <!-- Problem Number -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono"
                    >Problem Number</span
                >
                <span
                    class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                >
                    #{problem.n + 1}
                </span>
            </div>
        </div>

        <div
            class="flex flex-col gap-2 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-6"
        >
            <!-- Raw LaTeX Toggle -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono"
                    >Show Raw LaTeX</span
                >
                <Switch bind:checked={showRawLatex} size="sm" />
            </div>

            <!-- Difficulty and Quality -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono"
                    >Diff / Quality</span
                >
                <span
                    class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                >
                    D: {problem.difficulty ?? "N/A"} / Q: {problem.quality ??
                        "N/A"}
                </span>
            </div>

            <!-- Topic -->
            <div class="flex items-center justify-between gap-4 py-0.5">
                <span class="text-muted-foreground font-mono">Topic</span>
                <span
                    class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                >
                    {topicName}
                </span>
            </div>

            <!-- Answer / Answer Index -->
            {#if problem.answer_index !== null && problem.answer_index !== undefined}
                <div class="flex items-center justify-between gap-4 py-0.5">
                    <span class="text-muted-foreground font-mono"
                        >Answer Index</span
                    >
                    <span
                        class="font-mono bg-correct-container/20 text-on-correct-container px-2 py-0.5 rounded border border-correct/30 font-semibold"
                    >
                        {problem.answer_index}
                        {#if problem.choices && problem.choices[problem.answer_index]}
                            ({problem.choices[problem.answer_index]})
                        {/if}
                    </span>
                </div>
            {/if}
        </div>
    </div>

    <!-- Glicko Match -->
    <div class="flex flex-col gap-2 border-t border-border/50 pt-2.5">
        <div
            class="flex items-center gap-2 text-muted-foreground font-mono text-[10px] uppercase tracking-wider"
        >
            <Icon name="swords" fontsize={14} class="text-primary-foreground" />
            <span>Glicko Match</span>
        </div>

        {#if match && playerRating && problemRating}
            <div
                class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5 text-xs"
            >
                <div class="flex flex-col gap-2">
                    <!-- Player rating -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span class="text-muted-foreground font-mono"
                            >You (rating ± RD)</span
                        >
                        <span
                            class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                        >
                            {Math.round(playerRating.rating)} ± {Math.round(
                                playerRating.rd,
                            )}
                            {#if playerRatingIsProvisional(playerRating)}
                                <span class="text-unsure">?</span>
                            {/if}
                        </span>
                    </div>

                    <!-- Problem rating -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span class="text-muted-foreground font-mono"
                            >Problem (rating ± RD)</span
                        >
                        <span
                            class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                        >
                            {Math.round(problemRating.rating)} ± {Math.round(
                                problemRating.rd,
                            )}
                            {#if ratingIsProvisional(problemRating)}
                                <span class="text-unsure">?</span>
                            {/if}
                        </span>
                    </div>

                    <!-- Rating gap -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span class="text-muted-foreground font-mono"
                            >Rating gap</span
                        >
                        <span
                            class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                        >
                            {signed(match.gap)}
                        </span>
                    </div>
                </div>

                <div
                    class="flex flex-col gap-2 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-6"
                >
                    <!-- Expected performance -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span class="text-foreground font-mono"
                            >Expected score (E)</span
                        >
                        <span
                            class="font-mono bg-primary/10 text-primary-foreground px-2 py-0.5 rounded border border-primary/30 font-semibold"
                            title="Your Glicko-expected solve probability for this problem"
                        >
                            {(match.expected * 100).toFixed(1)}%
                        </span>
                    </div>

                    <!-- Opponent attenuation g(RD) -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span class="text-muted-foreground font-mono"
                            >g(problem RD)</span
                        >
                        <span
                            class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 text-foreground font-semibold"
                        >
                            {match.g.toFixed(3)}
                        </span>
                    </div>

                    <!-- Projected swing -->
                    <div class="flex items-center justify-between gap-4 py-0.5">
                        <span
                            class="text-muted-foreground font-mono"
                            title="Idealized: full weight (w=1), decisive win/loss, no RD inflation. Live deltas are usually smaller once effort/retry/guess weighting and timed scoring apply (see docs/ratings.md §4)."
                        >
                            Projected Δ (win / loss)
                        </span>
                        <span
                            class="font-mono bg-surface-container px-2 py-0.5 rounded border border-border/50 font-semibold"
                        >
                            <span class="text-correct"
                                >{signed(match.deltaWin)}</span
                            >
                            <span class="text-muted-foreground"> / </span>
                            <span class="text-destructive"
                                >{signed(match.deltaLoss)}</span
                            >
                        </span>
                    </div>
                </div>
            </div>
        {:else}
            <p class="text-xs text-muted-foreground font-mono py-0.5">
                {#if !playerRating}
                    No player rating yet — solve a graded problem to seed it.
                {:else if !problemRating}
                    This problem has no rating yet (unplayed).
                {/if}
            </p>
        {/if}
    </div>
</div>
