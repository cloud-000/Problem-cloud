<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { cn } from "$lib/utils";
    import { prefersReducedMotion } from "svelte/motion";
    import { fade, slide } from "svelte/transition";

    let { data } = $props();
    // The public shell is told only whether someone is signed in, never the
    // session itself (see `(splash)/+layout.server.ts`).
    let signedIn = $derived(data.signedIn);

    /** One source of truth: the tab strip and the try-it panel both read
     *  from this list. */
    const disciplines = [
        {
            id: "algebra",
            label: "Algebra",
            color: "var(--algebra)",
            statement:
                "Find the sum of all real solutions to the equation $$x^2 - 5x + 6 = 0.$$",
            answer: "5",
            hint: "Factor as $(x-2)(x-3)=0$, so the roots are $x=2$ and $x=3$. Vieta's formulas give the same sum directly.",
        },
        {
            id: "combinatorics",
            label: "Combinatorics",
            color: "var(--combinatorics)",
            statement:
                "A committee of $3$ people is chosen from a group of $5$. How many different committees are possible?",
            answer: "10",
            hint: "Order does not matter, so count with $\\binom{n}{k}=\\frac{n!}{k!(n-k)!}$ and evaluate $\\binom{5}{3}$.",
        },
        {
            id: "geometry",
            label: "Geometry",
            color: "var(--geometry)",
            statement:
                "A right triangle has legs of length $5$ and $12$. What is the length of its hypotenuse?",
            answer: "13",
            hint: "By the Pythagorean theorem, $5^2 + 12^2 = 169$, and $169$ is a perfect square.",
        },
        {
            id: "number-theory",
            label: "Number theory",
            color: "var(--number-theory)",
            statement:
                "What is the remainder when $2^{100}$ is divided by $3$?",
            answer: "1",
            hint: "Work modulo $3$: since $2 \\equiv -1$, we get $2^{100} \\equiv (-1)^{100}$.",
        },
    ] as const;

    type DisciplineKey = (typeof disciplines)[number]["id"];

    const capabilities = [
        {
            title: "One searchable library",
            body: "Filter by contest, year, topic, or difficulty. Every problem keeps its source, so the original is always one click away.",
        },
        {
            title: "A rating that means something",
            body: "Each graded answer is a rated match between you and the problem. Your skill and the problem's difficulty live on the same scale.",
        },
        {
            title: "Review that comes back to you",
            body: "Solved problems return on a spaced schedule, and your history keeps every attempt and answer you have given.",
        },
        {
            title: "Room to think",
            body: "Sketch on built-in scratch paper, or bring your own model key for a coach that talks to the provider directly from your browser.",
        },
    ];

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
            a: "A practice platform for middle school, high school, and collegiate math competitions. It collects and categorizes contest problems so preparation happens in one place instead of across a dozen tabs.",
        },
        {
            q: "How is the math rendered?",
            a: "Statements are typeset with KaTeX in the browser, so equations, diagrams, and notation render quickly and read like the original paper.",
        },
        {
            q: "Is it free?",
            a: "Yes. Practicing is free, and an account adds your history, accuracy and rating tracking, and saved practice sessions.",
        },
    ];

    let selected = $state<DisciplineKey>("algebra");
    let current = $derived(
        disciplines.find((d) => d.id === selected) ?? disciplines[0],
    );

    type Verdict = "unanswered" | "empty" | "correct" | "wrong";

    let answers = $state<Record<string, string>>({});
    let verdicts = $state<Record<string, Verdict>>({});
    let hintOpen = $state<Record<string, boolean>>({});
    let shaking = $state(false);

    let verdict = $derived(verdicts[selected] ?? "unanswered");

    /** Transitions carry state changes here, so they shorten to zero rather
     *  than disappearing when the user asks for reduced motion. */
    let motion = $derived(prefersReducedMotion.current ? 0 : 1);

    const number = new Intl.NumberFormat();
    let problemLabel = $derived(
        data.problemCount === null ? null : number.format(data.problemCount),
    );
    let testLabel = $derived(
        data.testCount === null ? null : number.format(data.testCount),
    );
    let yearSpan = $derived(
        data.earliestYear && data.latestYear
            ? `${data.earliestYear}–${data.latestYear}`
            : null,
    );

    function check() {
        const given = (answers[selected] ?? "").trim();
        if (!given) {
            verdicts[selected] = "empty";
            return;
        }

        if (given === current.answer) {
            verdicts[selected] = "correct";
            return;
        }

        verdicts[selected] = "wrong";
        if (prefersReducedMotion.current) return;
        shaking = true;
        setTimeout(() => (shaking = false), 360);
    }
</script>

<svelte:head>
    <title>ProblemCloud — contest math practice in one place</title>
    <meta
        name="description"
        content="{problemLabel ??
            'Thousands of'} contest math problems from MATHCOUNTS, AMC, AIME, HMMT, PUMAC and more — complete papers in one searchable library, with your history, skill rating, and review queue kept in order."
    />
</svelte:head>

<div class="mx-auto w-full min-w-0 max-w-[1040px] px-sm pb-xl sm:px-md md:px-xl">
    <!-- Hero -->
    <section
        class="grid min-w-0 items-center gap-lg pt-lg pb-lg sm:gap-xl sm:pt-xl sm:pb-xl lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:pt-[4.5rem] lg:pb-[4.5rem]"
    >
        <div class="rise min-w-0">
            <h1 class="type-hero text-foreground text-balance">
                Every problem in one place.
            </h1>
            <p class="type-lead text-muted-foreground mt-md max-w-[40ch]">
                Complete contest papers in one searchable library. Attempts
                recorded, skill rated, the next review already queued.
            </p>

            <div class="mt-lg flex flex-wrap items-center gap-sm">
                <Button
                    href={signedIn ? "/" : "/auth/signup"}
                    size="lg"
                    class="px-lg"
                    id="hero-get-started-btn"
                >
                    {signedIn ? "Go to your dashboard" : "Start practicing"}
                </Button>
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
                <p
                    class="type-secondary text-muted-foreground mt-1.5 tabular-nums"
                >
                    {#if testLabel}
                        {testLabel} complete tests
                        <span class="text-outline-variant mx-2">·</span>
                    {/if}
                    {#if yearSpan}
                        {yearSpan}
                        <span class="text-outline-variant mx-2">·</span>
                    {/if}
                    free to practice
                </p>
            {:else}
                <p class="type-caption text-muted-foreground mt-lg">
                    Free to practice
                </p>
            {/if}
        </div>

        <!-- Try it: the product itself, not a picture of it -->
        <div class="rise rise-late min-w-0 w-full">
            <div
                class="border-border bg-surface-container-lowest min-w-0 overflow-hidden rounded-xl border"
            >
                <div
                    class="scrollbar-none border-border/70 flex gap-md overflow-x-auto border-b px-md sm:gap-lg sm:px-lg"
                    role="group"
                    aria-label="Sample problem by discipline"
                >
                    {#each disciplines as d (d.id)}
                        <button
                            type="button"
                            aria-pressed={selected === d.id}
                            onclick={() => (selected = d.id)}
                            class="tab type-secondary shrink-0 py-2.5 whitespace-nowrap sm:py-3"
                            class:tab-active={selected === d.id}
                            style:--tab-color={d.color}
                            id="sandbox-tab-{d.id}"
                        >
                            {d.label}
                        </button>
                    {/each}
                </div>

                <div class="p-md sm:p-lg" class:animate-answer-shake={shaking}>
                    <p class="type-caption text-muted-foreground">
                        Sample problem
                    </p>

                    {#key selected}
                        <div
                            in:fade={{ duration: 140 * motion }}
                            class="sample-statement mt-sm flex min-h-[5rem] min-w-0 items-center sm:min-h-[7.5rem]"
                        >
                            <LaTeX
                                class="type-problem text-foreground w-full min-w-0 max-w-full"
                            >
                                {current.statement}
                            </LaTeX>
                        </div>
                    {/key}

                    <div
                        class="mt-md flex min-w-0 flex-col gap-sm sm:flex-row sm:items-end"
                    >
                        <div class="min-w-0 flex-1">
                            <label
                                for="sandbox-answer-input"
                                class="type-caption text-muted-foreground mb-1.5 block"
                                >Your answer</label
                            >
                            <Input
                                id="sandbox-answer-input"
                                bind:value={answers[selected]}
                                placeholder="Type a number"
                                autocomplete="off"
                                class="font-mono"
                                oninput={() =>
                                    (verdicts[selected] = "unanswered")}
                                onkeydown={(e: KeyboardEvent) =>
                                    e.key === "Enter" && check()}
                            />
                        </div>
                        <Button
                            onclick={check}
                            class="w-full shrink-0 sm:w-auto"
                            id="sandbox-submit-btn">Check</Button
                        >
                    </div>

                    <div
                        class="mt-md flex min-h-8 flex-wrap items-center justify-between gap-x-md gap-y-1"
                    >
                        <button
                            type="button"
                            onclick={() =>
                                (hintOpen[selected] = !hintOpen[selected])}
                            class="type-secondary text-muted-foreground hover:text-foreground transition-colors"
                            aria-expanded={hintOpen[selected] ?? false}
                            id="sandbox-hint-btn"
                        >
                            {hintOpen[selected] ? "Hide hint" : "Show a hint"}
                        </button>

                        {#if verdict === "correct"}
                            <span
                                class="type-secondary text-correct flex items-center gap-1.5"
                                transition:fade={{ duration: 160 * motion }}
                            >
                                <Icon name="check_circle" fontsize="18px" />
                                Correct
                            </span>
                        {:else if verdict === "wrong"}
                            <span
                                class="type-secondary text-destructive"
                                transition:fade={{ duration: 160 * motion }}
                            >
                                Not quite — try again
                            </span>
                        {:else if verdict === "empty"}
                            <span
                                class="type-secondary text-muted-foreground"
                                transition:fade={{ duration: 160 * motion }}
                            >
                                Enter an answer first
                            </span>
                        {/if}
                    </div>

                    {#if hintOpen[selected]}
                        <div
                            transition:slide={{ duration: 180 * motion }}
                            class="border-border/70 mt-sm border-t pt-sm"
                        >
                            <LaTeX
                                class="type-secondary text-muted-foreground font-serif"
                            >
                                {current.hint}
                            </LaTeX>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </section>

    <!-- Sources: the corpus is the argument, so it is listed, not summarised -->
    <section class="border-border/60 border-t py-xl">
        <h2 class="type-display text-foreground max-w-[22ch] text-balance">
            Complete contests, not a selection.
        </h2>
        <p class="type-secondary text-muted-foreground mt-md max-w-[54ch]">
            Sit a whole paper, or pull one problem out of it — including
            invitationals that usually exist only as a scanned PDF.
        </p>

        {#if data.series.length}
            <ul
                class="mt-xl grid grid-cols-2 gap-sm sm:grid-cols-3 sm:gap-md lg:grid-cols-4"
            >
                {#each data.series as series (series.id)}
                    <li
                        class="border-border bg-surface-container-lowest flex h-full min-w-0 flex-col justify-between gap-1 rounded-lg border px-md py-md"
                    >
                        <p
                            class="type-body text-foreground font-semibold text-pretty"
                        >
                            {series.name}
                        </p>
                        {#if series.testCount > 0}
                            <p
                                class="type-secondary text-muted-foreground mt-1 tabular-nums"
                            >
                                {number.format(series.testCount)}
                                {series.testCount === 1 ? "paper" : "papers"}
                            </p>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    <!-- What you get -->
    <section class="border-border/60 border-t py-xl">
        <h2 class="type-display text-foreground max-w-[20ch] text-balance">
            Practice that keeps track of itself.
        </h2>
        <div class="mt-xl grid gap-x-xl gap-y-lg sm:grid-cols-2">
            {#each capabilities as capability, i (capability.title)}
                <div class="border-border/60 border-t pt-md">
                    <span class="type-code text-outline-variant"
                        >{String(i + 1).padStart(2, "0")}</span
                    >
                    <h3 class="type-section-title text-foreground mt-1">
                        {capability.title}
                    </h3>
                    <p
                        class="type-secondary text-muted-foreground mt-1.5 max-w-[52ch]"
                    >
                        {capability.body}
                    </p>
                </div>
            {/each}
        </div>
    </section>

    <!-- The problem matrix: shown, because a paragraph cannot carry it -->
    <section class="border-border/60 border-t py-xl">
        <h2 class="type-section-title text-foreground">Every gap in one grid</h2>
        <p class="type-secondary text-muted-foreground mt-1.5 max-w-[68ch]">
            A series opens as a matrix — one row per contest, one cell per
            problem. The shade is how confident you are, the mark is what you
            did, and a ring means the problem is due for review. The holes in a
            decade of papers are visible at a glance, and every cell opens the
            problem.
        </p>

        <figure class="mt-lg">
            <div class="scrollbar-none overflow-x-auto">
                <div class="w-max min-w-full" aria-hidden="true">
                    <div class="flex items-center gap-1">
                        <span class="w-28 shrink-0"></span>
                        {#each matrixColumns as column (column)}
                            <span
                                class="type-caption text-outline-variant w-6 shrink-0 text-center font-mono"
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
                                        "flex size-6 shrink-0 items-center justify-center rounded border",
                                        MASTERY_CLASS[cell.mastery],
                                        "due" in cell &&
                                            cell.due &&
                                            "ring-primary/60 ring-offset-background ring-2 ring-offset-1",
                                    )}
                                >
                                    {#if cell.mark}
                                        <Icon
                                            name={cell.mark}
                                            fontsize="0.8rem"
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
                <span class="text-outline-variant"
                    >Illustration — five AMC 10 papers with example progress.</span
                >
            </figcaption>
        </figure>
    </section>

    <!-- Questions -->
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
                    <p class="type-secondary text-muted-foreground max-w-[70ch] pb-md">
                        {item.a}
                    </p>
                </details>
            {/each}
        </div>
    </section>

    <!-- Close -->
    <section
        class="border-border/60 flex flex-col items-start gap-md border-t py-xl sm:flex-row sm:items-center sm:justify-between"
    >
        <div>
            <h2 class="type-display text-foreground">Start with one problem.</h2>
            <p class="type-secondary text-muted-foreground mt-1.5">
                An account is free, and your history starts from the first
                answer you submit.
            </p>
        </div>
        <Button
            href={signedIn ? "/" : "/auth/signup"}
            size="lg"
            class="px-lg"
            id="bottom-cta-btn"
        >
            {signedIn ? "Go to your dashboard" : "Create free account"}
        </Button>
    </section>
</div>

<style>
    .tab {
        color: var(--color-muted-foreground);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition:
            color 160ms ease,
            border-color 160ms ease;
    }

    .tab:hover {
        color: var(--color-foreground);
    }

    .tab-active {
        color: var(--tab-color);
        border-bottom-color: var(--tab-color);
    }

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

    /* One entrance, on first paint only — motion for continuity, not decor. */
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

    @media (prefers-reduced-motion: reduce) {
        .rise {
            animation: none;
        }

        .faq :global(.chevron) {
            transition: none;
        }
    }

    /* Display math can exceed a phone width; scroll instead of widening the card. */
    .sample-statement :global(.katex-display) {
        margin: 0;
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
    }
</style>
