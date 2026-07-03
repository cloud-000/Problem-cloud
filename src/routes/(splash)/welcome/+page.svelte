<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { fade, slide, fly } from "svelte/transition";

    let { data } = $props();
    let session = $derived(data.session);

    // Text switching variables
    const words = ["unified", "frictionless", "seamless"];
    let currentWordIndex = $state(0);

    $effect(() => {
        const interval = setInterval(() => {
            currentWordIndex = (currentWordIndex + 1) % words.length;
        }, 2200);
        return () => clearInterval(interval);
    });

    // Problem count state
    let problemCount = $state<number | null>(null);
    let formattedCount = $derived.by(() => {
        if (problemCount === null || problemCount === 0) return "10,000";
        return new Intl.NumberFormat().format(problemCount);
    });

    $effect(() => {
        data.supabase
            .from("problems")
            .select("id", { count: "exact", head: true })
            .then(({ count, error }) => {
                if (!error && count !== null) {
                    problemCount = count;
                }
            });
    });

    // Selected category for the sandbox
    let selectedCategory = $state<
        "algebra" | "combinatorics" | "geometry" | "number-theory"
    >("algebra");

    // Interactive Sandbox Problems
    const problems = {
        algebra: {
            title: "Algebra",
            icon: "calculate",
            color: "var(--algebra)",
            question: "Find the sum of all real solutions to the equation:",
            math: "$$x^2 - 5x + 6 = 0$$",
            placeholder: "Enter the sum...",
            answer: "5",
            hint: "Factor the quadratic equation into $(x-2)(x-3) = 0$. The roots are $x=2$ and $x=3$.",
        },
        combinatorics: {
            title: "Combinatorics",
            icon: "groups",
            color: "var(--combinatorics)",
            question:
                "A committee of $3$ people is to be chosen from a group of $5$ people. How many different committees can be formed?",
            math: "$$\\binom{5}{3}$$",
            placeholder: "Enter the number of committees...",
            answer: "10",
            hint: "Use the combination formula: $\\binom{n}{k} = \\frac{n!}{k!(n-k)!}$. Here, calculate $\\binom{5}{3}$.",
        },
        geometry: {
            title: "Geometry",
            icon: "change_history",
            color: "var(--geometry)",
            question:
                "In a right triangle, the legs have lengths $5$ and $12$. What is the length of the hypotenuse?",
            math: "$$c = \\sqrt{a^2 + b^2}$$",
            placeholder: "Enter the hypotenuse...",
            answer: "13",
            hint: "Use the Pythagorean theorem: $5^2 + 12^2 = 25 + 144 = 169 = 13^2$.",
        },
        "number-theory": {
            title: "Number Theory",
            icon: "tag",
            color: "var(--number-theory)",
            question: "What is the remainder when $2^{100}$ is divided by $3$?",
            math: "$$2^{100} \\pmod{3}$$",
            placeholder: "Enter the remainder...",
            answer: "1",
            hint: "Note that $2 \\equiv -1 \\pmod 3$. Therefore, $2^{100} \\equiv (-1)^{100} \\equiv 1 \\pmod 3$.",
        },
    };

    // User's answers for each category
    let answers = $state<Record<string, string>>({
        algebra: "",
        combinatorics: "",
        geometry: "",
        "number-theory": "",
    });

    // Submissions and validation states
    let states = $state<Record<string, "idle" | "correct" | "incorrect">>({
        algebra: "idle",
        combinatorics: "idle",
        geometry: "idle",
        "number-theory": "idle",
    });

    // Shake animation indicators
    let shake = $state<Record<string, boolean>>({
        algebra: false,
        combinatorics: false,
        geometry: false,
        "number-theory": false,
    });

    // Hints visibility
    let showHint = $state<Record<string, boolean>>({
        algebra: false,
        combinatorics: false,
        geometry: false,
        "number-theory": false,
    });

    function checkAnswer() {
        const cat = selectedCategory;
        const problem = problems[cat];
        const trimmed = answers[cat].trim();

        if (!trimmed) {
            toasts.warning("Please input an answer before submitting.");
            return;
        }

        if (trimmed === problem.answer) {
            states[cat] = "correct";
            toasts.success("Correct! That is the right answer. 🎉");
        } else {
            states[cat] = "incorrect";
            shake[cat] = true;
            toasts.error(
                "Not quite! Double check your calculations and try again.",
            );
            setTimeout(() => {
                shake[cat] = false;
            }, 360);
        }
    }
</script>

<svelte:head>
    <title>ProblemCloud — Master Math Contest Problem Solving</title>
    <meta
        name="description"
        content="Curated training system for math competitions. Master Algebra, Combinatorics, Geometry, and Number Theory through interactive exercises."
    />
</svelte:head>

<!-- Hero Section -->
<section
    class="relative pt-20 md:py-32 flex flex-col items-center justify-center text-center px-6 max-w-5xl mx-auto"
>
    <div
        class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/80 bg-surface-container-lowest text-xs font-semibold text-muted-foreground mb-6 shadow-xs animate-fade-in"
    >
        <span class="w-1.5 h-1.5 rounded-full bg-correct"></span>
        Now supporting Svelte 5 & Tailwind v4
    </div>

    <h1
        class="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-[1.15] px-4 flex flex-col items-center"
    >
        <span
            class="relative inline-block w-full max-w-[280px] md:max-w-[440px] h-[1.25em] overflow-visible my-1.5"
        >
            {#key currentWordIndex}
                <span
                    in:fly={{ y: 24, duration: 350, delay: 100 }}
                    out:fly={{ y: -24, duration: 250 }}
                    class="absolute inset-0 flex justify-center items-center"
                >
                    <span
                        class="text-primary-foreground capitalize inline-block whitespace-nowrap"
                    >
                        {words[currentWordIndex]}
                    </span>
                </span>
            {/key}
        </span>
        <span class="text-foreground">Practice</span>
    </h1>

    <p
        class="text-lg md:text-xl text-muted-foreground max-w-3xl mb-10 leading-relaxed"
    >
        Stop juggling open browser tabs, fragmented PDFs, and forum links.
        ProblemCloud unifies contest math prep into a single, cohesive dashboard
        that records your progress, stores your history, and provides smart
        hints when you get stuck. We make it simple to grind, practice, and
        study.
    </p>

    <div
        class="flex flex-col sm:flex-row items-center gap-4 w-full justify-center"
    >
        <Button
            href={session ? "/" : "/auth/signup"}
            size="lg"
            class="w-full sm:w-auto px-8 font-semibold shadow-md cursor-pointer"
            id="hero-get-started-btn"
        >
            Get Started Free
        </Button>
        <Button
            href="/library"
            variant="outline"
            size="lg"
            class="w-full sm:w-auto px-8 cursor-pointer"
            id="hero-explore-btn"
        >
            Explore Problems
        </Button>
    </div>
</section>

<!-- Over {count} Problems Strip -->
<section
    class="w-full py-12 bg-surface-container-low/40 border-t border-b border-border/30 transition-colors"
>
    <div class="max-w-7xl mx-auto px-6 text-center">
        <h2 class="text-2xl md:text-3xl font-bold tracking-tight mb-8">
            Over <span
                class="text-primary-foreground font-extrabold text-3xl md:text-4xl"
                >{formattedCount}+</span
            > Problems from Famous Competitions
        </h2>
        <div class="flex flex-wrap items-center justify-center gap-4 md:gap-6">
            <div
                class="px-5 py-3 rounded-xl border border-border bg-surface-container-lowest flex items-center gap-3 shadow-xs hover:border-[var(--algebra)] transition-all duration-300"
            >
                <Icon name="verified" class="text-[var(--algebra)]" />
                <span class="text-sm font-semibold">AMC 8 / 10 / 12</span>
            </div>
            <div
                class="px-5 py-3 rounded-xl border border-border bg-surface-container-lowest flex items-center gap-3 shadow-xs hover:border-[var(--combinatorics)] transition-all duration-300"
            >
                <Icon name="verified" class="text-[var(--combinatorics)]" />
                <span class="text-sm font-semibold">AIME</span>
            </div>
            <div
                class="px-5 py-3 rounded-xl border border-border bg-surface-container-lowest flex items-center gap-3 shadow-xs hover:border-[var(--geometry)] transition-all duration-300"
            >
                <Icon name="verified" class="text-[var(--geometry)]" />
                <span class="text-sm font-semibold">Mandelbrot</span>
            </div>
            <div
                class="px-5 py-3 rounded-xl border border-border bg-surface-container-lowest flex items-center gap-3 shadow-xs hover:border-[var(--number-theory)] transition-all duration-300"
            >
                <Icon name="verified" class="text-[var(--number-theory)]" />
                <span class="text-sm font-semibold">Purple Comet!</span>
            </div>
            <div
                class="px-5 py-3 rounded-xl border border-border bg-surface-container-lowest flex items-center gap-3 shadow-xs hover:border-primary-foreground transition-all duration-300"
            >
                <Icon name="verified" class="text-primary-foreground" />
                <span class="text-sm font-semibold">HMMT & Caltech HM</span>
            </div>
        </div>
    </div>
</section>

<!-- Float SVG Graphic / Mockup Section -->
<section class="py-16 max-w-5xl mx-auto px-6 flex flex-col items-center">
    <div
        class="w-full max-w-3xl rounded-2xl border border-border/80 p-2 bg-surface-container-low/40 backdrop-blur-xs shadow-xl relative"
    >
        <div
            class="absolute -top-3 -left-3 bg-surface-container-lowest border border-border px-3 py-1 rounded-full text-xs font-mono text-[var(--algebra)] shadow-xs"
        >
            f(x) = sin(x) + cos(x)
        </div>
        <div
            class="absolute -bottom-3 -right-3 bg-surface-container-lowest border border-border px-3 py-1 rounded-full text-xs font-mono text-[var(--geometry)] shadow-xs"
        >
            a² + b² = c²
        </div>
        <div
            class="bg-surface-container-lowest rounded-xl p-6 md:p-8 flex items-center justify-center overflow-hidden border border-border/40 min-h-[220px]"
        >
            <div
                class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center w-full text-left"
            >
                <div>
                    <span
                        class="text-xs font-bold text-[var(--algebra)] uppercase tracking-wider block mb-2"
                        >Sample Olympiad Problem</span
                    >
                    <h3 class="text-lg font-semibold mb-3">
                        Find all solutions in positive integers.
                    </h3>
                    <div
                        class="bg-surface-container-low/80 p-4 rounded-lg border border-border/50 text-sm font-serif"
                    >
                        <LaTeX>
                            Determine all pairs of positive integers $(x, y)$
                            such that: $$x^2 - y! = 2026$$
                        </LaTeX>
                    </div>
                </div>
                <div class="flex flex-col gap-3">
                    <div
                        class="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-surface-container-low/30"
                    >
                        <Icon name="check_circle" class="text-correct" />
                        <span class="text-sm font-medium"
                            >Automatic verification & stats</span
                        >
                    </div>
                    <div
                        class="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-surface-container-low/30"
                    >
                        <Icon name="draw" class="text-[var(--geometry)]" />
                        <span class="text-sm font-medium"
                            >Visual geometry diagrams</span
                        >
                    </div>
                    <div
                        class="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-surface-container-low/30"
                    >
                        <Icon
                            name="bar_chart"
                            class="text-[var(--number-theory)]"
                        />
                        <span class="text-sm font-medium"
                            >Personalized learning roadmaps</span
                        >
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Comparison Section -->
<section class="py-20 max-w-7xl mx-auto px-6 border-b border-border/30">
    <div class="text-center max-w-3xl mx-auto mb-16">
        <h2 class="text-3xl font-bold tracking-tight mb-4">
            Stop Juggling. Start Solving.
        </h2>
        <p class="text-muted-foreground">
            We designed ProblemCloud specifically to eliminate the friction of
            traditional contest math prep.
        </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
        <!-- The Old Way -->
        <div
            class="border border-border/50 bg-surface-container-low/20 rounded-2xl p-8 relative overflow-hidden"
        >
            <div
                class="absolute top-4 right-4 text-xs font-semibold px-2 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/20"
            >
                The Old Way
            </div>
            <h3
                class="text-xl font-bold mb-6 text-foreground flex items-center gap-2"
            >
                <Icon name="close" class="text-destructive" /> Chaos & Friction
            </h3>
            <ul class="space-y-4">
                <li class="flex gap-3 text-sm text-muted-foreground">
                    <Icon
                        name="link_off"
                        class="text-destructive flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Juggle dozens of open browser tabs, PDFs, and forum
                        links.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-muted-foreground">
                    <Icon
                        name="history_toggle_off"
                        class="text-destructive flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >No central record of which problems you solved,
                        skipped, or got wrong.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-muted-foreground">
                    <Icon
                        name="question_mark"
                        class="text-destructive flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Stuck on a problem? Spend hours digging for hints or
                        solutions.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-muted-foreground">
                    <Icon
                        name="grid_view"
                        class="text-destructive flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Manually keep track of your strengths and weaknesses on
                        scrap paper.</span
                    >
                </li>
            </ul>
        </div>

        <!-- The ProblemCloud Way -->
        <div
            class="border border-[var(--algebra)]/30 bg-surface-container-lowest rounded-2xl p-8 relative overflow-hidden shadow-md"
        >
            <div
                class="absolute top-4 right-4 text-xs font-semibold px-2 py-1 rounded-md bg-correct/10 text-correct border border-correct/20"
            >
                The ProblemCloud Way
            </div>
            <h3
                class="text-xl font-bold mb-6 text-foreground flex items-center gap-2"
            >
                <Icon name="check" class="text-correct" /> Unified & Focused
            </h3>
            <ul class="space-y-4">
                <li class="flex gap-3 text-sm text-foreground">
                    <Icon
                        name="cloud"
                        class="text-[var(--algebra)] flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Thousands of problems from famous contests,
                        consolidated in one dashboard.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-foreground">
                    <Icon
                        name="analytics"
                        class="text-[var(--algebra)] flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Automatically log your practice history, streaks, and
                        correct rates.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-foreground">
                    <Icon
                        name="lightbulb"
                        class="text-[var(--algebra)] flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >Immediate help with smart, incremental hints whenever
                        you get stuck.</span
                    >
                </li>
                <li class="flex gap-3 text-sm text-foreground">
                    <Icon
                        name="trending_up"
                        class="text-[var(--algebra)] flex-shrink-0"
                        fontsize="20px"
                    />
                    <span
                        >A personal roadmap that points out where to study and
                        practice next.</span
                    >
                </li>
            </ul>
        </div>
    </div>
</section>

<!-- Features Section -->
<section
    id="features"
    class="py-20 bg-surface-container-low/50 transition-colors border-t border-b border-border/50"
>
    <div class="max-w-7xl mx-auto px-6">
        <div class="text-center max-w-3xl mx-auto mb-16">
            <h2 class="text-3xl font-bold tracking-tight mb-4">
                Master Every Math Domain
            </h2>
            <p class="text-muted-foreground">
                Four specialized sections packed with problems spanning all
                levels of math competitions, from AMC 8 to IMO.
            </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- Algebra -->
            <div
                class="group border border-border/60 hover:border-[var(--algebra)]/40 rounded-2xl p-6 bg-surface-container-lowest hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                style="border-top-width: 4px; border-top-color: var(--algebra);"
            >
                <div>
                    <div
                        class="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                        style="background-color: color-mix(in oklab, var(--algebra) 10%, transparent); color: var(--algebra)"
                    >
                        <Icon name="calculate" fontsize="24px" />
                    </div>
                    <h3
                        class="text-lg font-bold mb-2 group-hover:text-[var(--algebra)] transition-colors"
                    >
                        Algebra
                    </h3>
                    <p
                        class="text-sm text-muted-foreground leading-relaxed mb-4"
                    >
                        Equations, systems, inequalities, sequences, and
                        polynomials. Focus on symbolic manipulation and
                        structure.
                    </p>
                </div>
                <div
                    class="text-xs font-semibold text-muted-foreground bg-surface-container-low py-1.5 px-3 rounded-md w-fit"
                >
                    Polynomials, Cauchy-Schwarz, Recurrences
                </div>
            </div>

            <!-- Combinatorics -->
            <div
                class="group border border-border/60 hover:border-[var(--combinatorics)]/40 rounded-2xl p-6 bg-surface-container-lowest hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                style="border-top-width: 4px; border-top-color: var(--combinatorics);"
            >
                <div>
                    <div
                        class="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                        style="background-color: color-mix(in oklab, var(--combinatorics) 10%, transparent); color: var(--combinatorics)"
                    >
                        <Icon name="groups" fontsize="24px" />
                    </div>
                    <h3
                        class="text-lg font-bold mb-2 group-hover:text-[var(--combinatorics)] transition-colors"
                    >
                        Combinatorics
                    </h3>
                    <p
                        class="text-sm text-muted-foreground leading-relaxed mb-4"
                    >
                        Counting, probability, Pigeonhole Principle, graph
                        theory, and grid pathing. Develop systematic reasoning.
                    </p>
                </div>
                <div
                    class="text-xs font-semibold text-muted-foreground bg-surface-container-low py-1.5 px-3 rounded-md w-fit"
                >
                    Permutations, Graph Coloring, Bijection
                </div>
            </div>

            <!-- Geometry -->
            <div
                class="group border border-border/60 hover:border-[var(--geometry)]/40 rounded-2xl p-6 bg-surface-container-lowest hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                style="border-top-width: 4px; border-top-color: var(--geometry);"
            >
                <div>
                    <div
                        class="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                        style="background-color: color-mix(in oklab, var(--geometry) 10%, transparent); color: var(--geometry)"
                    >
                        <Icon name="change_history" fontsize="24px" />
                    </div>
                    <h3
                        class="text-lg font-bold mb-2 group-hover:text-[var(--geometry)] transition-colors"
                    >
                        Geometry
                    </h3>
                    <p
                        class="text-sm text-muted-foreground leading-relaxed mb-4"
                    >
                        Triangles, circles, polygon properties, coordinate
                        geometry, and trigonometry. Enhance spatial
                        relationships.
                    </p>
                </div>
                <div
                    class="text-xs font-semibold text-muted-foreground bg-surface-container-low py-1.5 px-3 rounded-md w-fit"
                >
                    Power of a Point, Cyclic Quadrilaterals
                </div>
            </div>

            <!-- Number Theory -->
            <div
                class="group border border-border/60 hover:border-[var(--number-theory)]/40 rounded-2xl p-6 bg-surface-container-lowest hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                style="border-top-width: 4px; border-top-color: var(--number-theory);"
            >
                <div>
                    <div
                        class="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                        style="background-color: color-mix(in oklab, var(--number-theory) 10%, transparent); color: var(--number-theory)"
                    >
                        <Icon name="tag" fontsize="24px" />
                    </div>
                    <h3
                        class="text-lg font-bold mb-2 group-hover:text-[var(--number-theory)] transition-colors"
                    >
                        Number Theory
                    </h3>
                    <p
                        class="text-sm text-muted-foreground leading-relaxed mb-4"
                    >
                        Divisibility, modular arithmetic, prime factorization,
                        Diophantine equations, and base representation.
                    </p>
                </div>
                <div
                    class="text-xs font-semibold text-muted-foreground bg-surface-container-low py-1.5 px-3 rounded-md w-fit"
                >
                    Fermat's Little Theorem, Euclidean Algorithm
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Sandbox Section -->
<section id="sandbox" class="py-20 max-w-7xl mx-auto px-6">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <!-- Left Header Info -->
        <div class="lg:col-span-5 text-left">
            <div
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-bold text-primary-foreground mb-4"
            >
                Interactive Demo
            </div>
            <h2 class="text-3xl font-bold tracking-tight mb-6">
                Interactive Practice Sandbox
            </h2>
            <p class="text-muted-foreground mb-6 leading-relaxed">
                Test drive our interface. ProblemCloud formats algebraic
                equations, indices, binomial coefficients, and modular equations
                cleanly. Select a discipline to attempt its math challenge.
            </p>
            <div class="flex flex-col gap-4">
                <div class="flex items-start gap-3">
                    <Icon name="check" class="text-correct mt-0.5" />
                    <div>
                        <h4 class="text-sm font-semibold">
                            Immediate Feedback
                        </h4>
                        <p class="text-xs text-muted-foreground">
                            Answers are validated immediately using our
                            client-side checking system.
                        </p>
                    </div>
                </div>
                <div class="flex items-start gap-3">
                    <Icon name="help" class="text-[var(--algebra)] mt-0.5" />
                    <div>
                        <h4 class="text-sm font-semibold">
                            Step-by-step Hints
                        </h4>
                        <p class="text-xs text-muted-foreground">
                            Stuck on a calculation? Click the hint toggle for
                            hints formatted in LaTeX.
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Right Interactive Card -->
        <div class="lg:col-span-7">
            <div
                class="bg-surface-container-lowest border border-border/80 rounded-2xl p-6 md:p-8 shadow-xl relative transition-all duration-300"
            >
                <!-- Category tab selectors -->
                <div
                    class="flex flex-wrap gap-2 mb-6 border-b border-border/50 pb-4"
                >
                    {#each Object.entries(problems) as [key, problem]}
                        <button
                            onclick={() => (selectedCategory = key as any)}
                            class="px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-all duration-200 cursor-pointer flex items-center gap-1.5"
                            style="
                                    background-color: {selectedCategory === key
                                ? `color-mix(in oklab, ${problem.color} 15%, transparent)`
                                : 'transparent'};
                                    color: {selectedCategory === key
                                ? problem.color
                                : 'var(--color-muted-foreground)'};
                                    border-color: {selectedCategory === key
                                ? `color-mix(in oklab, ${problem.color} 30%, transparent)`
                                : 'var(--color-border)'};
                                "
                            id="sandbox-tab-{key}"
                        >
                            <Icon name={problem.icon} fontsize="14px" />
                            {problem.title}
                        </button>
                    {/each}
                </div>

                <!-- Problem Card Body -->
                {#key selectedCategory}
                    {@const problem = problems[selectedCategory]}
                    <div
                        class="flex flex-col gap-6"
                        class:animate-answer-shake={shake[selectedCategory]}
                        in:fade={{ duration: 150 }}
                    >
                        <div>
                            <span
                                class="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                            >
                                Question Statement
                            </span>
                            <p class="text-sm text-foreground mt-1 mb-4">
                                <LaTeX>{problem.question}</LaTeX>
                            </p>
                            <div
                                class="bg-surface-container-low border border-border/40 p-6 rounded-xl flex items-center justify-center"
                            >
                                <LaTeX
                                    class="text-xl md:text-2xl font-semibold tracking-wide text-foreground"
                                >
                                    {problem.math}
                                </LaTeX>
                            </div>
                        </div>

                        <!-- Input and action area -->
                        <div class="flex flex-col gap-4">
                            <label
                                for="sandbox-answer-input"
                                class="text-xs font-bold uppercase tracking-wider text-muted-foreground block"
                            >
                                Your Answer
                            </label>
                            <div class="flex gap-3">
                                <input
                                    type="text"
                                    id="sandbox-answer-input"
                                    bind:value={answers[selectedCategory]}
                                    placeholder={problem.placeholder}
                                    class="flex-1 px-4 py-2 text-sm rounded-lg border border-input focus:border-primary-foreground focus:ring-3 focus:ring-primary-foreground/20 outline-hidden transition-all bg-background text-foreground"
                                    onkeydown={(e) =>
                                        e.key === "Enter" && checkAnswer()}
                                />
                                <Button
                                    onclick={checkAnswer}
                                    variant="default"
                                    class="cursor-pointer"
                                    id="sandbox-submit-btn"
                                >
                                    Check
                                </Button>
                            </div>
                        </div>

                        <!-- Submission response message -->
                        {#if states[selectedCategory] === "correct"}
                            <div
                                transition:slide={{ duration: 200 }}
                                class="flex items-center gap-2 p-3 rounded-lg bg-correct/10 text-correct border border-correct/20 text-sm font-medium"
                            >
                                <Icon name="check_circle" />
                                <span
                                    >Correct! You solved the {problem.title} challenge!</span
                                >
                            </div>
                        {:else}
                            <div
                                class="flex items-center justify-between text-xs mt-1"
                            >
                                <button
                                    onclick={() =>
                                        (showHint[selectedCategory] =
                                            !showHint[selectedCategory])}
                                    class="text-primary-foreground hover:underline font-semibold cursor-pointer flex items-center gap-1"
                                    id="sandbox-hint-btn"
                                >
                                    <Icon name="lightbulb" fontsize="14px" />
                                    {showHint[selectedCategory]
                                        ? "Hide Hint"
                                        : "Need a Hint?"}
                                </button>
                                {#if states[selectedCategory] === "incorrect"}
                                    <span
                                        class="text-destructive font-medium flex items-center gap-1"
                                        transition:fade
                                    >
                                        <Icon name="cancel" fontsize="14px" /> Incorrect.
                                        Try again.
                                    </span>
                                {/if}
                            </div>
                        {/if}

                        <!-- Hint Textbox -->
                        {#if showHint[selectedCategory]}
                            <div
                                transition:slide={{ duration: 250 }}
                                class="p-4 rounded-xl bg-surface-container border border-border/50 text-xs text-muted-foreground leading-relaxed font-serif animate-fade-in"
                            >
                                <span
                                    class="font-sans font-bold uppercase tracking-wider text-[10px] text-foreground block mb-1"
                                    >Method / Hint</span
                                >
                                <LaTeX>{problem.hint}</LaTeX>
                            </div>
                        {/if}
                    </div>
                {/key}
            </div>
        </div>
    </div>
</section>

<!-- FAQ / Stats Section -->
<section
    id="about"
    class="py-20 bg-surface-container-low/50 transition-colors border-t border-border/50"
>
    <div class="max-w-4xl mx-auto px-6">
        <h2
            class="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12"
        >
            Frequently Asked Questions
        </h2>

        <div class="flex flex-col gap-6">
            <div
                class="border border-border/50 bg-surface-container-lowest rounded-xl p-6"
            >
                <h3 class="font-semibold text-base mb-2">
                    What is ProblemCloud?
                </h3>
                <p class="text-sm text-muted-foreground leading-relaxed">
                    ProblemCloud is a math learning platform optimized for
                    middle school, high school, and collegiate math
                    competitions. It compiles and categorizes math problems to
                    optimize preparation for contests like the AMC, AIME, USAMO,
                    and ARML.
                </p>
            </div>

            <div
                class="border border-border/50 bg-surface-container-lowest rounded-xl p-6"
            >
                <h3 class="font-semibold text-base mb-2">
                    How are math formulas rendered?
                </h3>
                <p class="text-sm text-muted-foreground leading-relaxed">
                    Formulas are rendered locally using the KaTeX math
                    typesetting library. This guarantees fast performance and
                    high-quality rendering matching standard LaTeX equations.
                </p>
            </div>

            <div
                class="border border-border/50 bg-surface-container-lowest rounded-xl p-6"
            >
                <h3 class="font-semibold text-base mb-2">
                    Is the platform free?
                </h3>
                <p class="text-sm text-muted-foreground leading-relaxed">
                    Yes! ProblemCloud is fully open-source and free to practice.
                    Create an account to log your history, track your
                    correct/attempted analytics, and start building custom
                    practice templates.
                </p>
            </div>
        </div>
    </div>
</section>

<!-- Final CTA Banner -->
<section class="py-16 md:py-24 text-center px-6 border-t border-border/50">
    <div class="max-w-4xl mx-auto flex flex-col items-center">
        <h2 class="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Hop on
        </h2>
        <p class="text-muted-foreground max-w-5xl mb-8 leading-relaxed">
            Join our community and tackle algebra, geometry, combinations, and
            prime indices with confidence.
        </p>
        <Button
            href={session ? "/" : "/auth/signup"}
            size="lg"
            class="px-8 font-semibold shadow-md cursor-pointer"
            id="bottom-cta-btn"
        >
            Create Free Account
        </Button>
    </div>
</section>

<style>
    /* Keyframes for simple fadeIn animation on load */
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .animate-fade-in {
        animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
</style>
