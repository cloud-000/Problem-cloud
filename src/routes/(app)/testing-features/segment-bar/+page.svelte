<script lang="ts">
    import { SegmentBar, type Segment } from "$lib/components/segment-bar";
    import { Icon } from "$lib/components/icon";

    // Practice-outcome example (the real usage in PracticeView's top bar).
    let correct = $state(7);
    let incorrect = $state(3);
    let skipped = $state(2);

    let outcomeSegments = $derived<Segment[]>([
        { value: correct, color: "var(--color-correct)", label: "Solved" },
        { value: incorrect, color: "var(--color-destructive)", label: "Incorrect" },
        { value: skipped, color: "var(--color-unsure)", label: "Skipped" },
    ]);

    // Discipline split example — arbitrary colors, more than three sections.
    const disciplineSegments: Segment[] = [
        { value: 40, color: "var(--algebra)", label: "Algebra" },
        { value: 25, color: "var(--combinatorics)", label: "Combinatorics" },
        { value: 20, color: "var(--geometry)", label: "Geometry" },
        { value: 15, color: "var(--number-theory)", label: "Number Theory" },
    ];

    const swatch = [
        { name: "Solved", color: "var(--color-correct)" },
        { name: "Incorrect", color: "var(--color-destructive)" },
        { name: "Skipped", color: "var(--color-unsure)" },
    ];
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto pb-12">
    <!-- Header -->
    <div
        class="border-b border-border/80 pb-4 flex items-center justify-between"
    >
        <div>
            <h1
                class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
            >
                <Icon
                    name="data_usage"
                    fontsize="2.25rem"
                    class="text-primary-foreground"
                />
                Segment Bar Test Bench
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
                A proportional bar built from a <code>{"{ value, color }"}</code>
                list. Widths scale to each section's share of the total.
            </p>
        </div>
        <a
            href="/testing-features"
            class="text-sm font-medium text-primary-foreground hover:underline flex items-center gap-1 border border-border rounded-md px-3 py-1.5 bg-surface-container-lowest shadow-xs hover:bg-surface-container transition-colors"
        >
            <Icon name="arrow_back" fontsize="1.1rem" />
            Back to Hub
        </a>
    </div>

    <!-- Interactive practice-outcome example -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4"
    >
        <h3
            class="text-lg font-semibold text-foreground border-b border-border/50 pb-2"
        >
            Practice Outcomes (interactive)
        </h3>

        <SegmentBar segments={outcomeSegments} />

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-correct font-medium">Solved: {correct}</span>
                <input type="range" min="0" max="20" bind:value={correct} />
            </label>
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-destructive font-medium"
                    >Incorrect: {incorrect}</span
                >
                <input type="range" min="0" max="20" bind:value={incorrect} />
            </label>
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-unsure font-medium">Skipped: {skipped}</span>
                <input type="range" min="0" max="20" bind:value={skipped} />
            </label>
        </div>

        <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {#each swatch as { name, color }}
                <span class="inline-flex items-center gap-1.5">
                    <span
                        class="size-3 rounded-full"
                        style="background-color: {color}"
                    ></span>
                    {name}
                </span>
            {/each}
        </div>
    </div>

    <!-- Other configurations -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-6"
    >
        <h3
            class="text-lg font-semibold text-foreground border-b border-border/50 pb-2"
        >
            Other Configurations
        </h3>

        <div class="space-y-2">
            <p class="text-xs text-muted-foreground uppercase font-semibold">
                Many sections (discipline split)
            </p>
            <SegmentBar segments={disciplineSegments} />
        </div>

        <div class="space-y-2">
            <p class="text-xs text-muted-foreground uppercase font-semibold">
                Single section
            </p>
            <SegmentBar
                segments={[{ value: 1, color: "var(--color-correct)" }]}
            />
        </div>

        <div class="space-y-2">
            <p class="text-xs text-muted-foreground uppercase font-semibold">
                Empty (total 0 → just the track)
            </p>
            <SegmentBar
                segments={[{ value: 0, color: "var(--color-correct)" }]}
            />
        </div>

        <div class="space-y-2">
            <p class="text-xs text-muted-foreground uppercase font-semibold">
                Custom width &amp; taller (via class)
            </p>
            <SegmentBar class="h-4 w-48" segments={outcomeSegments} />
        </div>
    </div>
</div>
