<script lang="ts">
    import { enhance } from "$app/forms";

    let { children } = $props();
</script>

<svelte:head>
    <title>ProblemCloud</title>
    <meta
        name="description"
        content="Sign in to ProblemCloud to practice competition math."
    />
</svelte:head>

<main class="relative min-h-screen overflow-hidden bg-surface-container-low p-md sm:p-lg">
    <div
        class="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-secondary-container/70 blur-3xl"
    ></div>
    <div
        class="pointer-events-none absolute -right-32 -bottom-40 size-[30rem] rounded-full bg-primary/70 blur-3xl"
    ></div>

    <div
        class="relative mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl overflow-hidden rounded-xl border border-outline-variant/70 bg-surface-container-lowest shadow-2xl shadow-secondary/10 sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[0.9fr_1.1fr]"
    >
        <section
            class="relative hidden flex-col justify-between overflow-hidden bg-primary-container p-xl text-inverse-on-surface lg:flex"
        >
            <div
                class="pointer-events-none absolute -top-20 -right-20 size-72 rounded-full border-[3rem] border-secondary-container/10"
            ></div>
            <div
                class="pointer-events-none absolute right-12 bottom-20 size-40 rotate-12 rounded-xl border border-inverse-primary/15"
            ></div>

            <a href="/welcome" class="relative flex w-fit items-center gap-sm font-semibold">
                <span
                    class="grid size-9 place-items-center rounded-lg bg-secondary-container text-on-secondary-container shadow-lg shadow-black/20"
                    aria-hidden="true"
                >
                    ∑
                </span>
                <span class="tracking-tight">ProblemCloud</span>
            </a>

            <div class="relative max-w-md">
                <p
                    class="mb-md text-label-caps font-semibold tracking-[0.18em] text-inverse-primary uppercase"
                >
                    Practice with purpose
                </p>
                <h1 class="font-serif text-4xl leading-tight font-semibold text-white">
                    Every hard problem makes the next one easier.
                </h1>
                <p class="mt-lg max-w-sm leading-relaxed text-inverse-primary">
                    Build your competition math skills with focused practice,
                    thoughtful solutions, and progress that follows you.
                </p>
            </div>

            <p class="relative text-sm text-inverse-primary/80">
                Algebra · Combinatorics · Geometry · Number theory
            </p>
        </section>

        <section class="flex items-center justify-center px-lg py-xl sm:px-xl lg:px-12 xl:px-16">
            <div class="w-full">
                <a
                    href="/welcome"
                    class="mb-xl flex w-fit items-center gap-sm font-semibold text-foreground lg:hidden"
                >
                    <span
                        class="grid size-9 place-items-center rounded-lg bg-secondary-container text-on-secondary-container"
                        aria-hidden="true"
                    >
                        ∑
                    </span>
                    ProblemCloud
                </a>

                <form method="POST" use:enhance class="flex w-full flex-col gap-lg">
                    {@render children()}
                </form>
            </div>
        </section>
    </div>
</main>
