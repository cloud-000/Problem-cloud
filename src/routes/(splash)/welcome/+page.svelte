<script lang="ts">
    import { Button } from "#lib/components/button/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import LaTeX from "#lib/components/LaTeX.svelte";
    import { cn } from "#lib/utils.js";
    import { markGuestSeenAppShell } from "#lib/guest-app-shell.js";
    import { prefersReducedMotion } from "svelte/motion";
    import { fade } from "svelte/transition";
    import { untrack } from "svelte";
    import { initialFeaturedContest, nextFeaturedContest } from "./welcome-featured";
    import WelcomeFilters from "./WelcomeFilters.svelte";
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
            a: "Yes. Free with every account — hints, not answers. Bring your own key if you prefer.",
        },
        {
            q: "Is it free?",
            a: "Yes. Practice and a monthly free Coach allowance. An account adds history, rating, and review.",
        },
        {
            q: "Can I filter?",
            a: "Yes. Topic, series, division, problem numbers, years.",
        },
    ];

    let motion = $derived(prefersReducedMotion.current ? 0 : 1);

    const number = new Intl.NumberFormat();
    let problemLabel = $derived(
        data.problemCount === null ? null : number.format(data.problemCount),
    );

    type SeriesChip = (typeof data.series)[number];

    function isFeaturedContest(name: string): boolean {
        return /mathcounts|purple\s*comet|mandelbrot/i.test(name);
    }

    function setTickerSpeed(event: PointerEvent, speed: number) {
        if (event.pointerType === "touch") return;
        const track = event.currentTarget as HTMLDivElement;
        for (const animation of track.getAnimations()) {
            // Change speed without resetting the row's position in its loop.
            animation.updatePlaybackRate(speed);
        }
    }

    function contestRows(series: SeriesChip[]): SeriesChip[][] {
        if (!series.length) return [];
        return Array.from({ length: 5 }, (_, i) => {
            // Each row visits the whole catalog before repeating. Stagger
            // the starting points so neighboring rows show different names.
            const offset = Math.floor((i * series.length) / 5);
            const ordered = [...series.slice(offset), ...series.slice(0, offset)];
            // Repeat only complete passes, preserving variety at the seam.
            return Array.from(
                { length: Math.ceil(16 / series.length) },
                () => ordered,
            ).flat();
        });
    }

    let rows = $derived(contestRows(data.series));
    let featuredContest = $state(untrack(() => initialFeaturedContest(data.series.map((series) => series.name))));

    $effect(() => {
        const names = data.series.map((series) => series.name);
        const reducedMotion = motion === 0;
        featuredContest = initialFeaturedContest(names);
        if (reducedMotion || names.length < 2) return;
        const timer = setInterval(() => {
            featuredContest = nextFeaturedContest(names, featuredContest);
        }, 4000);
        return () => clearInterval(timer);
    });
</script>

<svelte:head>
    <link rel="preload" href="/fonts/source-serif-4-200-900-normal-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
    <title>ProblemCloud — contest math practice with free AI</title>
    <meta
        name="description"
        content="{problemLabel ??
            'Thousands of'} contest math problems from MATHCOUNTS, AMC, AIME, HMMT, PUMAC and more — complete papers, a review grid, and a free AI coach."
    />
</svelte:head>

<div class="hero relative isolate overflow-hidden">
    {#if data.series.length}
        <div class="hero-contests ticker" class:paused={motion === 0} aria-hidden="true">
            {#each rows as row, i (i)}
                <div
                    class="ticker-track"
                    role="presentation"
                    class:reverse={i % 2 === 1}
                    onpointerenter={(event) => setTickerSpeed(event, 0.2)}
                    onpointerleave={(event) => setTickerSpeed(event, 1)}
                    style:--ticker-duration="{80 + i * 8}s"
                >
                    {#each [0, 1] as copy (copy)}
                        <ul class="flex shrink-0 gap-3">
                            {#each row as series, j (`${i}-${copy}-${j}-${series.id}`)}
                                <li
                                    class={cn(
                                        "contest-chip shrink-0 rounded-lg border px-5 py-3 text-base whitespace-nowrap sm:text-lg",
                                        isFeaturedContest(series.name)
                                            ? "border-primary/50 bg-primary/15 text-primary-foreground font-semibold"
                                            : "border-border/70 bg-surface-container-lowest text-muted-foreground",
                                    )}
                                    class:featured={isFeaturedContest(series.name)}
                                >
                                    {series.name}
                                </li>
                            {/each}
                        </ul>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
    <div class="hero-content relative mx-auto w-full min-w-0 max-w-[1040px] px-sm sm:px-md md:px-xl">
        <!-- Hero -->
        <section
            class={cn(
                "grid min-w-0 items-center gap-lg sm:gap-xl",
                data.problems.length > 0 &&
                    "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
            )}
        >
            <div class="rise min-w-0">
                <p class="type-caption text-muted-foreground mb-sm">
                    Contest math.
                </p>
                <h1 class="type-hero text-foreground text-balance">
                    <span class="block">Every problem in one place.</span>
                    <span class="text-primary-foreground block">With free AI.</span>
                </h1>
                <p class="type-secondary text-muted-foreground mt-md flex items-baseline gap-1.5">
                    Featuring
                    <span class="featured-name text-primary-foreground min-w-0 font-semibold">
                        <!-- Reserve the largest name's footprint throughout the rotation. -->
                        {#each data.series as series (series.id)}
                            <span class="invisible" aria-hidden="true">{series.name}</span>
                        {/each}
                        {#key featuredContest.name}
                            <span transition:fade={{ duration: 220 * motion }}>
                                {featuredContest.name}
                            </span>
                        {/key}
                    </span>
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
                    {:else}
                        <Button
                            href="/practice"
                            variant="outline"
                            size="lg"
                            class="px-lg"
                            id="hero-guest-practice-btn"
                            onclick={markGuestSeenAppShell}
                        >
                            Practice as a guest
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

            {#if data.problems.length}
                <div class="rise rise-late min-w-0 w-full">
                    <WelcomeTrainer problems={data.problems} />
                </div>
            {/if}
        </section>

    </div>
</div>

<div class="mx-auto w-full min-w-0 max-w-[1040px] px-sm sm:px-md md:px-xl">
    <section class="pb-xl" aria-labelledby="tools-heading">
        <h2
            id="tools-heading"
            class="type-display text-foreground max-w-[24ch] text-balance"
        >
            Free AI coach and review grid.
        </h2>

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
                            >Free</span
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
                    Free with every account. Hints, not answers.
                </figcaption>
            </figure>

            <figure class="min-w-0">
                <div class="scrollbar-none overflow-x-auto">
                    <div class="w-max min-w-full" aria-hidden="true">
                        <div class="flex items-center gap-1">
                            <span class="w-28 shrink-0"></span>
                            {#each matrixColumns as column (column)}
                                <span
                                    class="type-caption text-muted-foreground w-5 shrink-0 text-center font-mono text-[10px]"
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


<div class="mx-auto w-full min-w-0 max-w-[1040px] px-sm pb-xl sm:px-md md:px-xl">
    <section aria-labelledby="filters-heading" class="pt-xl pb-xl">
        <h2
            id="filters-heading"
            class="type-display text-foreground max-w-[22ch] text-balance"
        >
            Custom filters.
        </h2>
        <p class="type-secondary text-muted-foreground mt-md max-w-[48ch]">
            Practice the slice you want.
        </p>
        <figure class="mt-xl min-w-0">
            <WelcomeFilters />
        </figure>
    </section>

    {#if data.series.length}
        <section class="border-border/60 border-t py-xl" aria-labelledby="contests-heading">
            <h2 id="contests-heading" class="type-display text-foreground">
                Complete contests.
            </h2>
            <ul class="mt-lg grid gap-x-lg gap-y-sm sm:grid-cols-2 lg:grid-cols-3">
                {#each data.series as series (series.id)}
                    <li class="type-secondary text-muted-foreground">{series.name}</li>
                {/each}
            </ul>
        </section>
    {/if}

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
            <h2 class="type-display text-foreground text-balance">
                Start with free AI.
            </h2>
            <p class="type-secondary text-muted-foreground mt-1.5">
                One problem is enough. History starts with your first answer.
            </p>
        </div>
        <div class="flex flex-wrap items-center gap-sm">
            <Button
                href={signedIn ? "/" : "/auth/signup"}
                size="lg"
                class="px-lg"
                id="bottom-cta-btn"
            >
                {signedIn ? "Go!" : "Create free account"}
            </Button>
            {#if !signedIn}
                <Button
                    href="/"
                    variant="outline"
                    size="lg"
                    class="px-lg"
                    id="bottom-guest-practice-btn"
                    onclick={markGuestSeenAppShell}
                >
                    Practice as a guest
                </Button>
            {/if}
        </div>
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
            transform: translateY(8px);
        }
        to {
            transform: none;
        }
    }

    .rise {
        animation: rise 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .rise-late {
        animation-delay: 90ms;
    }

    .featured-name {
        display: inline-grid;
    }

    .featured-name > span {
        grid-area: 1 / 1;
    }

    .hero-content {
        pointer-events: none;
        padding-top: 3rem;
        padding-bottom: 3rem;
    }

    .hero-content > section > div {
        pointer-events: auto;
    }

    .hero-contests {
        position: absolute;
        z-index: -1;
        inset: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        gap: 1rem;
        user-select: none;
    }

    /* Soften only the reading area; the rows remain visible behind the hero. */
    .hero::after {
        content: "";
        position: absolute;
        z-index: -1;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
            ellipse at 40% 50%,
            color-mix(in srgb, var(--color-background) 94%, transparent),
            color-mix(in srgb, var(--color-background) 75%, transparent) 40%,
            transparent 80%
        );
    }

    .ticker {
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

    .ticker-track {
        display: flex;
        width: max-content;
        gap: 0.75rem;
        animation: ticker var(--ticker-duration, 32s) linear infinite;
        will-change: transform;
    }

    .contest-chip {
        opacity: 0.5;
        transition: opacity 180ms ease, background-color 180ms ease,
            border-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
    }

    .contest-chip.featured {
        opacity: 0.8;
    }

    .contest-chip:hover {
        opacity: 1;
        color: var(--color-primary-foreground);
        background-color: color-mix(in srgb, var(--color-primary) 20%, var(--color-background));
        border-color: var(--color-primary);
        box-shadow: inset 0 0 0 1px var(--color-primary);
    }

    .ticker-track.reverse {
        animation-direction: reverse;
    }

    .paused .ticker-track {
        animation: none;
    }

    @keyframes ticker {
        from {
            transform: translateX(0);
        }
        to {
            transform: translateX(calc(-50% - 0.375rem));
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .rise {
            animation: none;
        }

        .faq :global(.chevron),
        .contest-chip {
            transition: none;
        }

        .ticker-track {
            animation: none;
        }
    }
</style>
