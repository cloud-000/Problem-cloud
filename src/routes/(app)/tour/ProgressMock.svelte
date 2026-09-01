<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { RatingChart, type RatingPoint } from "$lib/components/rating-chart";
    import { cn } from "$lib/utils";

    type Mastery = "unassessed" | "needs_work" | "learning" | "confident";

    const masteryClass: Record<Mastery, string> = {
        unassessed:
            "border-border bg-surface-container-lowest text-muted-foreground",
        needs_work: "border-destructive/25 bg-destructive/15 text-destructive",
        learning: "border-unsure/25 bg-unsure/15 text-unsure",
        confident: "border-correct/25 bg-correct/15 text-correct",
    };
    const masteryLabel: Record<Mastery, string> = {
        unassessed: "Unseen",
        needs_work: "Needs work",
        learning: "Learning",
        confident: "Confident",
    };
    const masteryIcon: Record<Mastery, string> = {
        unassessed: "",
        needs_work: "close",
        learning: "remove",
        confident: "check",
    };

    const points: RatingPoint[] = [
        { at: "2026-01-12T12:00:00.000Z", rating: 1482, rd: 118 },
        { at: "2026-02-03T12:00:00.000Z", rating: 1508, rd: 96 },
        { at: "2026-02-28T12:00:00.000Z", rating: 1531, rd: 78 },
        { at: "2026-03-21T12:00:00.000Z", rating: 1564, rd: 64 },
        { at: "2026-04-18T12:00:00.000Z", rating: 1591, rd: 52 },
        { at: "2026-05-09T12:00:00.000Z", rating: 1624, rd: 44 },
    ];

    const tests = [
        {
            name: "2022 A",
            cells: [
                "confident",
                "confident",
                "learning",
                "confident",
                "needs_work",
                "learning",
                "unassessed",
                "unassessed",
            ] as Mastery[],
        },
        {
            name: "2022 B",
            cells: [
                "confident",
                "learning",
                "needs_work",
                "learning",
                "unassessed",
                "unassessed",
                "unassessed",
                "unassessed",
            ] as Mastery[],
        },
        {
            name: "2023 A",
            cells: [
                "confident",
                "confident",
                "confident",
                "learning",
                "learning",
                "needs_work",
                "unassessed",
                "unassessed",
            ] as Mastery[],
        },
        {
            name: "2023 B",
            cells: [
                "learning",
                "learning",
                "needs_work",
                "needs_work",
                "unassessed",
                "unassessed",
                "unassessed",
                "unassessed",
            ] as Mastery[],
        },
        {
            name: "2024 A",
            cells: [
                "confident",
                "confident",
                "learning",
                "confident",
                "needs_work",
                "learning",
                "unassessed",
                "unassessed",
            ] as Mastery[],
        },
    ];

    let selected = $state<{ test: string; n: number; mastery: Mastery } | null>(
        null,
    );
</script>

<div class="progress-mock-shell">
    <div class="progress-mock">
        <section class="panel rating-panel" aria-label="Sample rating climb">
            <p class="type-caption text-muted-foreground">Rating</p>
            <div class="panel-body">
                <RatingChart
                    {points}
                    height={168}
                    color="var(--color-primary-foreground)"
                    bandColor="var(--color-primary)"
                    bandOpacity={0.5}
                />
            </div>
            <p class="panel-caption type-caption text-muted-foreground">
                Hover a point. This is your Glicko climb after graded work.
            </p>
        </section>

        <div class="progress-mock-divider" aria-hidden="true"></div>

        <section class="panel matrix-panel" aria-label="Sample series matrix">
            <p class="type-caption text-muted-foreground">Series matrix</p>
            <div class="panel-body matrix-scroll">
                <table class="w-max min-w-full border-separate border-spacing-1">
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                class="w-16 px-1 py-0.5 text-left type-caption text-muted-foreground"
                            >
                                Test
                            </th>
                            {#each Array.from({ length: 8 }, (_, i) => i + 1) as n (n)}
                                <th
                                    scope="col"
                                    class="size-7 min-w-7 text-center font-mono type-caption text-muted-foreground"
                                >
                                    {n}
                                </th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each tests as test (test.name)}
                            <tr>
                                <th
                                    scope="row"
                                    class="px-1 text-left type-caption text-foreground"
                                >
                                    {test.name}
                                </th>
                                {#each test.cells as mastery, index (index)}
                                    {@const n = index + 1}
                                    {@const active =
                                        selected?.test === test.name && selected.n === n}
                                    <td class="size-7 min-w-7 p-0 text-center">
                                        <button
                                            type="button"
                                            class={cn(
                                                "mx-auto flex size-7 items-center justify-center rounded border transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                                                masteryClass[mastery],
                                                active &&
                                                    "scale-110 border-foreground/40 shadow-md",
                                            )}
                                            aria-label={`${test.name} problem ${n}: ${masteryLabel[mastery]}`}
                                            aria-pressed={active}
                                            onclick={() =>
                                                (selected =
                                                    active
                                                        ? null
                                                        : { test: test.name, n, mastery })}
                                        >
                                            {#if masteryIcon[mastery]}
                                                <Icon
                                                    name={masteryIcon[mastery]}
                                                    fontsize="0.85rem"
                                                />
                                            {:else}
                                                <span
                                                    class="size-1 rounded-full bg-current opacity-25"
                                                ></span>
                                            {/if}
                                        </button>
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            <p class="panel-caption type-caption text-muted-foreground">
                {#if selected}
                    {selected.test} #{selected.n} — {masteryLabel[selected.mastery]}. Tap
                    another cell.
                {:else}
                    Tap a cell. Color is how well you know that problem.
                {/if}
            </p>
        </section>
    </div>
</div>

<style>
    .progress-mock-shell {
        container-type: size;
        container-name: progress-mock;
        display: flex;
        min-height: 0;
        flex: 1;
        flex-direction: column;
        overflow: hidden;
    }

    .progress-mock {
        display: grid;
        min-height: 0;
        min-width: 0;
        flex: 1;
        overflow: hidden;
        background: var(--color-surface-container-lowest);
        /* Side-by-side: equal halves with a centered vertical rule. */
        grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr);
    }

    .rating-panel {
        grid-column: 1;
        grid-row: 1;
    }

    .progress-mock-divider {
        grid-column: 2;
        grid-row: 1;
        align-self: stretch;
        width: 1px;
        background: var(--color-border);
    }

    .matrix-panel {
        grid-column: 3;
        grid-row: 1;
    }

    .panel {
        display: flex;
        min-height: 0;
        flex-direction: column;
        padding: 0.75rem;
    }

    .panel-body {
        margin-top: 0.5rem;
        min-height: 0;
        flex: 1;
    }

    .matrix-scroll {
        overflow: auto;
    }

    .panel-caption {
        margin-top: auto;
        padding-top: 0.5rem;
    }

    /* Stack rating above the matrix when the shell has enough height. */
    @container progress-mock (min-height: 24rem) {
        .progress-mock {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr) 1px minmax(0, 1fr);
        }

        .rating-panel {
            grid-column: 1;
            grid-row: 1;
        }

        .progress-mock-divider {
            grid-column: 1;
            grid-row: 2;
            align-self: stretch;
            width: 100%;
            height: 1px;
        }

        .matrix-panel {
            grid-column: 1;
            grid-row: 3;
        }
    }
</style>
