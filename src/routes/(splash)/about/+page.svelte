<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import LaTeX from "$lib/components/LaTeX.svelte";

    const pillars = [
        {
            title: "Algebra",
            icon: "calculate",
            color: "var(--algebra)",
            desc: "Develop proficiency in polynomials, systems of equations, sequences and series, inequalities, and functions.",
        },
        {
            title: "Combinatorics",
            icon: "groups",
            color: "var(--combinatorics)",
            desc: "Master counting principles, probability, bijections, graph theory, and pigeonhole principle applications.",
        },
        {
            title: "Geometry",
            icon: "change_history",
            color: "var(--geometry)",
            desc: "Strengthen spatial reasoning with Euclidean geometry, trigonometry, coordinate geometry, and vectors.",
        },
        {
            title: "Number Theory",
            icon: "tag",
            color: "var(--number-theory)",
            desc: "Uncover patterns through modular arithmetic, divisibility, prime numbers, Diophantine equations, and functions.",
        },
    ];
</script>

<svelte:head>
    <title>About Us — ProblemCloud</title>
    <meta
        name="description"
        content="Learn about ProblemCloud's mission to make math competition training seamless, interactive, and beautiful for students worldwide."
    />
</svelte:head>

<div class="py-16 md:py-24 px-6 max-w-5xl mx-auto flex flex-col items-center">
    <!-- Hero / Title -->
    <div class="text-center max-w-3xl mb-16 animate-fade-in">
        <div
            class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/80 bg-surface-container-lowest text-xs font-semibold text-muted-foreground mb-6 shadow-xs"
        >
            <span
                class="w-1.5 h-1.5 rounded-full bg-[var(--primary-foreground)]"
            ></span>
            Our Mission
        </div>
        <h1
            class="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 leading-tight"
        >
            Empowering the Next Generation of <span
                class="bg-gradient-to-r from-[var(--algebra)] to-[var(--number-theory)] bg-clip-text text-transparent"
                >Problem Solvers</span
            >
        </h1>
        <p class="text-lg text-muted-foreground leading-relaxed mb-6">
            I built ProblemCloud because I was tired of the traditional friction
            of contest math prep. In the past, preparing meant juggling dozens
            of open tabs, scanning through fragmented PDFs, AoPS Forums, Wiki,
            and keeping track of your progress manually.
        </p>
        <p class="text-base text-muted-foreground leading-relaxed">
            ProblemCloud unifies high-quality problems from a wide variety of
            contest sources into a single, cohesive, central dashboard. We
            remove the barriers and eliminate the friction, making it simple for
            you to grind, practice, and study without distraction.
        </p>
    </div>

    <!-- The Four Pillars -->
    <section class="w-full mb-20">
        <h2
            class="text-2xl md:text-3xl font-bold tracking-tight text-center mb-10"
        >
            Four Core Disciplines
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            {#each pillars as pillar}
                <div
                    class="border border-border/50 bg-surface-container-lowest rounded-xl p-6 transition-all hover:border-border/80 hover:shadow-sm"
                >
                    <div class="flex items-center gap-3 mb-4">
                        <div
                            class="p-2.5 rounded-lg text-white flex items-center justify-center"
                            style="background-color: {pillar.color}"
                        >
                            <Icon name={pillar.icon} fontsize="20px" />
                        </div>
                        <h3 class="text-lg font-bold">{pillar.title}</h3>
                    </div>
                    <p class="text-sm text-muted-foreground leading-relaxed">
                        {pillar.desc}
                    </p>
                </div>
            {/each}
        </div>
    </section>

    <!-- Platform Features -->
    <section
        class="w-full border-t border-border/50 pt-16 mb-16 grid grid-cols-1 md:grid-cols-3 gap-8"
    >
        <div class="flex flex-col items-center text-center p-4">
            <Icon
                name="history"
                class="text-primary-foreground mb-3"
                fontsize="36px"
            />
            <h3 class="font-semibold text-base mb-2">Progress Tracking</h3>
            <p class="text-xs text-muted-foreground leading-relaxed">
                Log your attempts, track your streak, and view detailed metrics
                on your accuracy and topics.
            </p>
        </div>
        <div class="flex flex-col items-center text-center p-4">
            <Icon
                name="code"
                class="text-primary-foreground mb-3"
                fontsize="36px"
            />
            <h3 class="font-semibold text-base mb-2">KaTeX Rendering</h3>
            <p class="text-xs text-muted-foreground leading-relaxed">
                Clean, high-performance LaTeX formulas loaded instantly for
                comfortable reading and solving.
            </p>
        </div>
        <div class="flex flex-col items-center text-center p-4">
            <Icon
                name="terminal"
                class="text-primary-foreground mb-3"
                fontsize="36px"
            />
            <h3 class="font-semibold text-base mb-2">Open Source</h3>
            <p class="text-xs text-muted-foreground leading-relaxed">
                Built with Svelte 5 and Tailwind CSS v4, our code is fully
                auditable, performant, and open for community contributions.
            </p>
        </div>
    </section>
</div>

<style>
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
