<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { cn } from "$lib/utils";
    import { prefersReducedMotion } from "svelte/motion";
    import WelcomeTrainer from "./WelcomeTrainer.svelte";

    let { data } = $props();
    // The public shell is told only whether someone is signed in, never the
    // session itself (see `(splash)/+layout.server.ts`).
    let signedIn = $derived(data.signedIn);

    /** An illustration of the Progress problem matrix, drawn with the same
     *  anatomy as the real grid in `(app)/progress/SeriesReviewGrid.svelte`:
     *  the shade is self-assessed mastery, the mark is what you did, and the
     *  ring means a review is due. The progress shown is invented — the
     *  figcaption says so — but the shape (early problems solved, later ones
     *  untouched, recent papers thinner) is what real practice looks like. */
    const MATRIX_LEGEND = {
        c: { mastery: "confident", mark: "check" },
        l: { mastery: "learning", mark: "check" },
        L: { mastery: "learning", mark: "check", due: true },
        n: { mastery: "needs_work", mark: "close" },
        N: { mastery: "needs_work", mark: "close", due: true },
        a: { mastery: "unassessed", mark: "close" },
        s: { mastery: "unassessed", mark: "remove" },
        ".": { mastery: "unassessed", mark: null },
    } as const satisfies Record<
        string,
        { mastery: string; mark: string | null; due?: boolean }
    >;

    const MASTERY_CLASS: Record<string, string> = {
        confident: "border-correct/25 bg-correct/15 text-correct",
        learning: "border-unsure/25 bg-unsure/15 text-unsure",
        needs_work: "border-destructive/25 bg-destructive/15 text-destructive",
        unassessed:
            "border-border bg-surface-container-lowest text-muted-foreground",
    };

    const matrixRows = [
        { label: "2022 AMC 10A", cells: "ccccccccccllclNna.a......" },
        { label: "2022 AMC 10B", cells: "cccccccclcllnnaan........" },
        { label: "2023 AMC 10A", cells: "ccccccclcclLnlnas........" },
        { label: "2023 AMC 10B", cells: "ccccccclclnnna..........." },
        { label: "2024 AMC 10A", cells: "cccccclcnna.............." },
    ].map((row) => ({
        label: row.label,
        cells: [...row.cells].map(
            (c) => MATRIX_LEGEND[c as keyof typeof MATRIX_LEGEND],
        ),
    }));

    const matrixColumns = Array.from({ length: 25 }, (_, i) => i + 1);

    const matrixKey = [
        { label: "Needs work", mastery: "needs_work" },
        { label: "Learning", mastery: "learning" },
        { label: "Confident", mastery: "confident" },
        { label: "Not assessed", mastery: "unassessed" },
    ];

    const questions = [
        {
            q: "What is ProblemCloud?",
            a: "Contest math practice. Complete papers in one place.",
        },
        {
            q: "Is there an AI coach?",
            a: "Yes. BYOK — your key, your browser. Hints, not answers.",
        },
        {
            q: "Is it free?",
            a: "Yes. An account adds history, rating, and review.",
        },
    ];

    let motion = $derived(prefersReducedMotion.current ? 0 : 1);

    const number = new Intl.NumberFormat();
    let problemLabel = $derived(
        data.problemCount === null ? null : number.format(data.problemCount),
    );

    type SeriesChip = (typeof data.series)[number];

    function contestRows(series: SeriesChip[]): SeriesChip[][] {
        const rows: SeriesChip[][] = [[], [], []];
        for (let i = 0; i < series.length; i++) {
            const item = series[i];
            if (item) rows[i % 3]?.push(item);
        }
        return rows.map((row, i) => fillRow(row, series, 6 + i));
    }

    /** A short row still has to fill the ticker; repeat from the full list
     *  rather than stretching three names across the viewport. */
    function fillRow(
        row: SeriesChip[],
        all: SeriesChip[],
        min: number,
    ): SeriesChip[] {
        const source = row.length > 0 ? row : all;
        if (source.length === 0) return [];
        const filled = [...source];
        let i = 0;
        while (filled.length < min) {
            const next = source[i % source.length];
            if (next) filled.push(next);
            i += 1;
        }
        return filled;
    }

    let rows = $derived(contestRows(data.series));
</script>

<svelte:head>
    <title>ProblemCloud — contest math practice in one place</title>
    <meta
        name="description"
        content="{problemLabel ??
            'Thousands of'} contest math problems from MATHCOUNTS, AMC, AIME, HMMT, PUMAC and more — complete papers, a review grid, and a BYOK coach."
    />
</svelte:head>

<div class="mx-auto w-full min-w-0 max-w-[1040px] px-sm pt-lg sm:px-md sm:pt-xl md:px-xl">
    <!-- Hero -->
    <section
        class="grid min-w-0 items-center gap-lg pb-lg sm:gap-xl sm:pb-xl lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pb-[3.5rem]"
    >
        <div class="rise min-w-0">
            <p class="type-caption text-muted-foreground mb-sm">
                Contest math.
            </p>
            <h1 class="type-hero text-foreground text-balance">
                Every problem in one place.
            </h1>
            <p class="type-lead text-muted-foreground mt-md max-w-[36ch]">
                Complete papers. A review grid. A BYOK coach — your key, your
                browser.
            </p>

            <div class="mt-lg flex flex-wrap items-center gap-sm">
                <Button
                    href={signedIn ? "/" : "/auth/signup"}
                    size="lg"
                    class="px-lg"
                    id="hero-get-started-btn"
                >
                    {signedIn ? "Go!" : "Start practicing"}
                </Button>
                {#if signedIn}
                    <Button
                        href="/library"
                        variant="ghost"
                        size="lg"
                        class="text-muted-foreground hover:text-foreground px-md"
                        id="hero-explore-btn"
                    >
                        Browse the library
                        <Icon name="arrow_forward" fontsize="18px" />
                    </Button>
                {/if}
            </div>

            {#if problemLabel}
                <p class="mt-lg flex flex-wrap items-baseline gap-x-sm gap-y-1">
                    <span
                        class="type-display text-foreground font-mono tabular-nums"
                        >{problemLabel}</span
                    >
                    <span class="type-secondary text-muted-foreground"
                        >problems</span
                    >
                </p>
            {/if}
        </div>

        <div class="rise rise-late min-w-0 w-full">
            <WelcomeTrainer />
        </div>
    </section>

    <section class="pb-xl" aria-labelledby="tools-heading">
        <h2
            id="tools-heading"
            class="type-display text-foreground max-w-[22ch] text-balance"
        >
            Coach and grid.
        </h2>
        <ul
            class="type-secondary text-muted-foreground mt-md flex flex-wrap gap-x-lg gap-y-1"
        >
            <li>BYOK coach</li>
            <li>Review grid</li>
            <li>Complete papers</li>
        </ul>

        <div class="mt-xl grid gap-lg lg:grid-cols-2">
            <figure class="min-w-0">
                <div
                    class="border-border bg-surface-container-lowest overflow-hidden rounded-xl border"
                >
                    <div
                        class="border-border/60 flex items-center gap-2 border-b px-md py-sm"
                    >
                        <Icon
                            name="auto_awesome"
                            fontsize="16px"
                            class="text-muted-foreground"
                        />
                        <span class="type-caption text-foreground">Coach</span>
                        <span class="type-caption text-muted-foreground"
                            >BYOK</span
                        >
                    </div>
                    <div class="flex flex-col gap-3 p-md">
                        <div
                            class="bg-muted/70 ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm text-foreground"
                        >
                            I don’t see a way in.
                        </div>
                        <div
                            class="border-border max-w-[92%] rounded-lg border px-3 py-2 text-sm"
                        >
                            <LaTeX class="text-foreground font-serif">
                                Look at $a^2 - b^2$ on its own for a moment. Do
                                the coefficients remind you of a factorization
                                you already know?
                            </LaTeX>
                        </div>
                    </div>
                </div>
                <figcaption class="type-caption text-muted-foreground mt-md">
                    BYOK. Hints, not answers.
                </figcaption>
            </figure>

            <figure class="min-w-0">
                <div class="scrollbar-none overflow-x-auto">
                    <div class="w-max min-w-full" aria-hidden="true">
                        <div class="flex items-center gap-1">
                            <span class="w-28 shrink-0"></span>
                            {#each matrixColumns as column (column)}
                                <span
                                    class="type-caption text-outline-variant w-5 shrink-0 text-center font-mono text-[10px]"
                                    >{column}</span
                                >
                            {/each}
                        </div>

                        {#each matrixRows as row (row.label)}
                            <div class="mt-1 flex items-center gap-1">
                                <span
                                    class="type-caption text-muted-foreground w-28 shrink-0 truncate"
                                    >{row.label}</span
                                >
                                {#each row.cells as cell, i (i)}
                                    <span
                                        class={cn(
                                            "flex size-5 shrink-0 items-center justify-center rounded border",
                                            MASTERY_CLASS[cell.mastery],
                                            "due" in cell &&
                                                cell.due &&
                                                "ring-primary/60 ring-offset-background ring-2 ring-offset-1",
                                        )}
                                    >
                                        {#if cell.mark}
                                            <Icon
                                                name={cell.mark}
                                                fontsize="0.7rem"
                                            />
                                        {:else}
                                            <span
                                                class="size-1 rounded-full bg-current opacity-25"
                                            ></span>
                                        {/if}
                                    </span>
                                {/each}
                            </div>
                        {/each}
                    </div>
                </div>

                <figcaption
                    class="type-caption text-muted-foreground mt-md flex flex-wrap items-center gap-x-lg gap-y-2"
                >
                    {#each matrixKey as key (key.mastery)}
                        <span class="flex items-center gap-1.5">
                            <span
                                class={cn(
                                    "size-3.5 rounded border",
                                    MASTERY_CLASS[key.mastery],
                                )}
                            ></span>
                            {key.label}
                        </span>
                    {/each}
                </figcaption>
            </figure>
        </div>
    </section>
</div>

{#if data.series.length}
    <section
        class="border-border/60 border-y py-md"
        aria-labelledby="contests-heading"
    >
        <div
            class="mx-auto w-full max-w-[1040px] px-sm sm:px-md md:px-xl"
        >
            <h2
                id="contests-heading"
                class="type-section-title text-foreground text-balance"
            >
                Complete contests.
            </h2>
        </div>

        <ul class="sr-only">
            {#each data.series as series (series.id)}
                <li>{series.name}</li>
            {/each}
        </ul>

        <div
            class="ticker mx-auto mt-md w-full max-w-[1040px]"
            class:paused={motion === 0}
            aria-hidden="true"
        >
            {#if motion === 0}
                <ul
                    class="flex flex-wrap gap-2 px-sm sm:px-md md:px-xl"
                >
                    {#each data.series as series (series.id)}
                        <li
                            class="border-border/70 bg-surface-container-lowest type-caption text-foreground rounded-md border px-3 py-1.5"
                        >
                            {series.name}
                        </li>
                    {/each}
                </ul>
            {:else}
                <div class="flex flex-col gap-2 overflow-hidden py-0.5">
                    {#each rows as row, i (i)}
                        <div
                            class="ticker-track"
                            class:reverse={i % 2 === 1}
                            style:--ticker-duration="{28 + i * 6}s"
                        >
                            {#each [0, 1] as copy (copy)}
                                <ul class="flex shrink-0 gap-2">
                                    {#each row as series, j (`${i}-${copy}-${j}-${series.id}`)}
                                        <li
                                            class="border-border/70 bg-surface-container-lowest type-caption text-foreground shrink-0 rounded-md border px-3 py-1.5 whitespace-nowrap"
                                        >
                                            {series.name}
                                            {#if series.testCount > 0}
                                                <span
                                                    class="text-muted-foreground tabular-nums"
                                                >
                                                    · {number.format(
                                                        series.testCount,
                                                    )}
                                                </span>
                                            {/if}
                                        </li>
                                    {/each}
                                </ul>
                            {/each}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </section>
{/if}

<div class="mx-auto w-full min-w-0 max-w-[1040px] px-sm pb-xl sm:px-md md:px-xl">
    <section class="border-border/60 border-t py-xl">
        <h2 class="type-section-title text-foreground">Common questions</h2>
        <div class="mt-md">
            {#each questions as item (item.q)}
                <details class="faq border-border/60 border-b">
                    <summary
                        class="type-body text-foreground hover:text-primary-foreground flex cursor-pointer items-center justify-between gap-md py-md transition-colors"
                    >
                        {item.q}
                        <Icon
                            name="expand_more"
                            fontsize="20px"
                            class="chevron text-muted-foreground shrink-0"
                        />
                    </summary>
                    <p
                        class="type-secondary text-muted-foreground max-w-[70ch] pb-md"
                    >
                        {item.a}
                    </p>
                </details>
            {/each}
        </div>
    </section>

    <section
        class="border-border/60 flex flex-col items-start gap-md border-t py-xl sm:flex-row sm:items-center sm:justify-between"
    >
        <div>
            <h2 class="type-display text-foreground">Start with one problem.</h2>
            <p class="type-secondary text-muted-foreground mt-1.5">
                Free. History starts with your first answer.
            </p>
        </div>
        <Button
            href={signedIn ? "/" : "/auth/signup"}
            size="lg"
            class="px-lg"
            id="bottom-cta-btn"
        >
            {signedIn ? "Go!" : "Create free account"}
        </Button>
    </section>
</div>

<style>
    .faq summary {
        list-style: none;
    }

    .faq summary::-webkit-details-marker {
        display: none;
    }

    .faq :global(.chevron) {
        transition: transform 180ms ease;
    }

    .faq[open] :global(.chevron) {
        transform: rotate(180deg);
    }

    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }

    .rise {
        animation: rise 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .rise-late {
        animation-delay: 90ms;
    }

    .ticker {
        position: relative;
        overflow: hidden;
        overscroll-behavior: none;
        mask-image: linear-gradient(
            90deg,
            transparent,
            #000 4rem,
            #000 calc(100% - 4rem),
            transparent
        );
        -webkit-mask-image: linear-gradient(
            90deg,
            transparent,
            #000 4rem,
            #000 calc(100% - 4rem),
            transparent
        );
    }

    .paused {
        mask-image: none;
        -webkit-mask-image: none;
    }

    .ticker-track {
        display: flex;
        width: max-content;
        gap: 0.5rem;
        animation: ticker var(--ticker-duration, 32s) linear infinite;
        will-change: transform;
    }

    .ticker-track.reverse {
        animation-direction: reverse;
    }

    .ticker:hover .ticker-track {
        animation-play-state: paused;
    }

    .paused .ticker-track {
        animation: none;
    }

    @keyframes ticker {
        from {
            transform: translateX(0);
        }
        to {
            transform: translateX(-50%);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .rise {
            animation: none;
        }

        .faq :global(.chevron) {
            transition: none;
        }

        .ticker-track {
            animation: none;
        }
    }
</style>
