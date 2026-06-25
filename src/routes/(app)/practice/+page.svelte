<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { RangeSlider } from "$lib/components/range-slider";
    import {
        Switch,
        TriStateSwitch,
        type TriState,
    } from "$lib/components/toggle";
    import {
        DIFFICULTY_RANGE,
        TOPICS,
        TOPIC_LABELS,
        type ProblemRow,
    } from "$lib/library";
    import {
        generatePracticeProblem,
        type PracticeAttempt,
        type PracticeSettings,
    } from "$lib/trainer";
    import { cn } from "$lib/utils";
    import { onMount } from "svelte";

    let { data }: { data: PageData } = $props();
    let { supabase } = $derived(data);

    const CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let topic = $state<string[]>([]);
    let difficulty = $state<[number, number]>([...DIFFICULTY_RANGE]);
    let verifiedOnly = $state(false);
    let computational = $state<TriState>("neutral");
    let showSettings = $state(false);

    let problem = $state<ProblemRow | null>(null);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let selectedChoice = $state<number | null>(null);
    let submitted = $state(false);
    let correct = $state<boolean | null>(null);
    let flagged = $state(false);
    let startedAt = $state(Date.now());
    let timerNow = $state(Date.now());
    let frozenElapsedMs = $state(0);
    let attempts = $state<PracticeAttempt[]>([]);
    let currentAttemptIndex = $state<number | null>(null);

    let loadToken = 0;

    let elapsedMs = $derived(
        problem && !submitted
            ? Math.max(0, timerNow - startedAt)
            : frozenElapsedMs,
    );
    let completedAttempts = $derived(
        attempts.filter((attempt) => attempt.correct !== null),
    );
    let correctAttempts = $derived(
        completedAttempts.filter((attempt) => attempt.correct).length,
    );
    let skippedAttempts = $derived(
        attempts.filter((attempt) => attempt.skipped).length,
    );
    let accuracy = $derived(
        completedAttempts.length === 0
            ? "0%"
            : `${Math.round((correctAttempts / completedAttempts.length) * 100)}%`,
    );

    function currentSettings(): PracticeSettings {
        return {
            topic: [...topic],
            difficulty: [difficulty[0], difficulty[1]],
            verifiedOnly,
            computational:
                computational === "neutral" ? null : computational === "on",
        };
    }

    function formatElapsed(ms: number) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes > 0
            ? `${minutes}:${String(seconds).padStart(2, "0")}`
            : `${seconds}s`;
    }

    function choiceText(choice: string) {
        const trimmed = choice.trim();
        if (
            trimmed.includes("$") ||
            trimmed.includes("\\(") ||
            trimmed.includes("\\[")
        ) {
            return trimmed;
        }
        return `$${trimmed}$`;
    }

    function topicLabel(code: string | null | undefined) {
        if (!code) return null;
        return TOPIC_LABELS[code] ?? code;
    }

    function computationalLabel(value: TriState) {
        if (value === "on") return "Computational";
        if (value === "off") return "Not computational";
        return "Any";
    }

    async function loadProblem(settings = currentSettings()) {
        const token = ++loadToken;
        const now = Date.now();

        loading = true;
        error = null;
        problem = null;
        selectedChoice = null;
        submitted = false;
        correct = null;
        flagged = false;
        currentAttemptIndex = null;
        frozenElapsedMs = 0;
        startedAt = now;
        timerNow = now;

        try {
            const nextProblem = await generatePracticeProblem(
                supabase,
                settings,
            );
            if (token !== loadToken) return;

            const loadedAt = Date.now();
            problem = nextProblem;
            startedAt = loadedAt;
            timerNow = loadedAt;
            frozenElapsedMs = 0;
        } catch (e) {
            if (token !== loadToken) return;
            error = (e as Error).message;
            frozenElapsedMs = Date.now() - now;
        } finally {
            if (token === loadToken) loading = false;
        }
    }

    function submitAnswer() {
        if (!problem || selectedChoice == null || submitted) return;

        const elapsed = Math.max(0, Date.now() - startedAt);
        const isCorrect = selectedChoice === problem.answer_index;

        submitted = true;
        correct = isCorrect;
        frozenElapsedMs = elapsed;
        currentAttemptIndex = attempts.length;
        attempts = [
            ...attempts,
            {
                problemId: problem.id,
                selectedChoice,
                correct: isCorrect,
                elapsedMs: elapsed,
                skipped: false,
                flagged,
            },
        ];
    }

    function skipProblem() {
        if (!problem || loading) return;

        attempts = [
            ...attempts,
            {
                problemId: problem.id,
                selectedChoice,
                correct: null,
                elapsedMs: Math.max(0, Date.now() - startedAt),
                skipped: true,
                flagged,
            },
        ];
        loadProblem();
    }

    function toggleFlag() {
        flagged = !flagged;
        if (currentAttemptIndex == null) return;

        attempts = attempts.map((attempt, i) =>
            i === currentAttemptIndex ? { ...attempt, flagged } : attempt,
        );
    }

    // Load the first problem once on mount. Settings are intentionally *not* a
    // dependency here: the panel applies them to the next generated problem
    // (Skip/Next/Retry call loadProblem(), which reads currentSettings()), so
    // tweaking a control — e.g. dragging the difficulty slider — must not fire a
    // reload per change.
    onMount(() => {
        loadProblem();
    });

    $effect(() => {
        if (!problem || submitted || loading) return;

        const timer = setInterval(() => {
            timerNow = Date.now();
        }, 250);

        return () => clearInterval(timer);
    });
</script>

{#snippet stat(label: string, value: string | number)}
    <div class="flex flex-col gap-0.5">
        <span class="text-label-caps font-medium text-muted-foreground"
            >{label}</span
        >
        <span class="font-mono text-sm text-foreground">{value}</span>
    </div>
{/snippet}

{#snippet badge(text: string)}
    <span
        class="inline-flex items-center rounded-full bg-surface-container px-2 py-0.5 text-xs text-muted-foreground"
    >
        {text}
    </span>
{/snippet}

{#snippet settingsPanel()}
    <aside
        class={cn(
            "flex flex-col gap-4 rounded-lg border border-border bg-surface-container-lowest p-4 lg:w-72 lg:shrink-0",
            showSettings ? "flex" : "hidden",
            "lg:flex",
        )}
    >
        <div class="flex items-center justify-between gap-3">
            <div>
                <h2 class="text-sm font-semibold">Settings</h2>
                <p class="text-xs text-muted-foreground">
                    Applies to the next generated problem.
                </p>
            </div>
            <Button
                class="lg:hidden"
                variant="ghost"
                size="icon-sm"
                aria-label="Close settings"
                onclick={() => (showSettings = false)}
            >
                <Icon name="close" />
            </Button>
        </div>

        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">Topic</span>
            <Combobox
                bind:value={topic}
                options={TOPICS}
                strict
                placeholder="Any topic"
                inputPlaceholder="Add topic"
            />
        </div>

        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">
                Difficulty ({difficulty[0]}-{difficulty[1]})
            </span>
            <RangeSlider
                bind:value={difficulty}
                min={DIFFICULTY_RANGE[0]}
                max={DIFFICULTY_RANGE[1]}
                step={1}
                label="Difficulty"
            />
        </div>

        <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-muted-foreground">
                    Verified only
                </span>
                <span class="text-xs text-muted-foreground">
                    {verifiedOnly ? "Verified" : "Any"}
                </span>
            </div>
            <Switch bind:checked={verifiedOnly} size="sm" />
        </div>

        <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-muted-foreground">
                    Computational
                </span>
                <span class="text-xs text-muted-foreground">
                    {computationalLabel(computational)}
                </span>
            </div>
            <TriStateSwitch bind:value={computational} size="sm" />
        </div>

        <Button
            variant="outline"
            class="w-full"
            onclick={() => {
                topic = [];
                difficulty = [...DIFFICULTY_RANGE];
                verifiedOnly = false;
                computational = "neutral";
            }}
        >
            Reset settings
        </Button>
    </aside>
{/snippet}

<div class="flex min-h-full flex-col gap-4 p-4 lg:p-6">
    <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
            <div>
                <h1 class="text-h2 font-semibold tracking-normal">Train</h1>
                <p class="text-sm text-muted-foreground">
                    Focused practice, one problem at a time.
                </p>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <div
                class="hidden items-center gap-5 rounded-md border border-border bg-surface-container-lowest px-3 py-2 sm:flex"
            >
                {@render stat("Solved", completedAttempts.length)}
                {@render stat("Accuracy", accuracy)}
                {@render stat("Skipped", skippedAttempts)}
            </div>
            <Button
                class="lg:hidden"
                variant="outline"
                size="icon"
                aria-label="Open settings"
                onclick={() => (showSettings = !showSettings)}
            >
                <Icon name="tune" />
            </Button>
        </div>
    </header>

    <div class="flex flex-1 flex-col gap-4 lg:flex-row">
        <main
            class="flex min-h-[min(720px,calc(100vh-9rem))] min-w-0 flex-1 items-center justify-center"
        >
            <section
                class="flex w-full max-w-3xl flex-col gap-5 rounded-lg border border-border bg-surface-container-lowest p-4 shadow-xs sm:p-6"
            >
                {#if loading}
                    <div
                        class="flex min-h-80 flex-col items-center justify-center gap-3 text-center"
                    >
                        <Icon
                            name="progress_activity"
                            class="animate-spin text-muted-foreground"
                            fontsize={28}
                        />
                        <p class="text-sm text-muted-foreground">
                            Generating problem...
                        </p>
                    </div>
                {:else if error}
                    <div
                        class="flex min-h-80 flex-col items-center justify-center gap-4 text-center"
                    >
                        <div
                            class="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"
                        >
                            <Icon name="error" fontsize={24} />
                        </div>
                        <div class="flex max-w-md flex-col gap-1">
                            <h2 class="font-semibold">
                                Could not load a problem
                            </h2>
                            <p class="text-sm text-muted-foreground">{error}</p>
                        </div>
                        <Button onclick={() => loadProblem()}>Retry</Button>
                    </div>
                {:else if !problem}
                    <div
                        class="flex min-h-80 flex-col items-center justify-center gap-4 text-center"
                    >
                        <div
                            class="flex size-11 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
                        >
                            <Icon name="filter_alt_off" fontsize={24} />
                        </div>
                        <div class="flex max-w-md flex-col gap-1">
                            <h2 class="font-semibold">No matching problems</h2>
                            <p class="text-sm text-muted-foreground">
                                Try broadening the settings, then generate
                                again.
                            </p>
                        </div>
                        <Button variant="outline" onclick={() => loadProblem()}>
                            Try again
                        </Button>
                    </div>
                {:else}
                    <div
                        class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"
                    >
                        <div
                            class="flex min-w-0 flex-wrap items-center gap-1.5"
                        >
                            {#if problem.tests?.name}
                                {@render badge(problem.tests.name)}
                            {/if}
                            {@render badge(`Problem ${problem.n + 1}`)}
                            {#if topicLabel(problem.topic)}
                                {@render badge(topicLabel(problem.topic) ?? "")}
                            {/if}
                        </div>

                        <div class="flex items-center gap-2">
                            <span
                                class="font-mono text-sm text-muted-foreground"
                            >
                                {formatElapsed(elapsedMs)}
                            </span>
                            <Button
                                variant={flagged ? "secondary" : "ghost"}
                                size="icon-sm"
                                aria-label={flagged
                                    ? "Unflag problem"
                                    : "Flag problem"}
                                aria-pressed={flagged}
                                onclick={toggleFlag}
                            >
                                <Icon name="flag" fill={flagged} />
                            </Button>
                        </div>
                    </div>

                    <div class="flex flex-col gap-6">
                        <MathStatement
                            text={problem.statement ?? ""}
                            class="mx-auto min-w-0 max-w-2xl text-center text-problem-text leading-8"
                        />

                        <div class="mx-auto grid w-full max-w-2xl gap-2">
                            {#each problem.choices ?? [] as choice, i (i)}
                                {@const selected = selectedChoice === i}
                                {@const isCorrect =
                                    submitted && problem.answer_index === i}
                                {@const isIncorrect =
                                    submitted &&
                                    selected &&
                                    problem.answer_index !== i}
                                <button
                                    type="button"
                                    disabled={submitted}
                                    aria-pressed={selected}
                                    class={cn(
                                        "flex min-h-12 w-full items-start gap-3 rounded-md border border-border bg-background px-3 py-3 text-left text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none",
                                        selected &&
                                            !submitted &&
                                            "border-primary bg-primary/30",
                                        isCorrect &&
                                            "border-correct bg-correct/10",
                                        isIncorrect &&
                                            "border-destructive bg-destructive/10",
                                    )}
                                    onclick={() => (selectedChoice = i)}
                                >
                                    <span
                                        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container font-mono text-xs font-semibold text-muted-foreground"
                                    >
                                        {CHOICE_LABELS[i] ?? i + 1}
                                    </span>
                                    <MathStatement
                                        text={choiceText(choice)}
                                        class="min-w-0 flex-1 leading-6"
                                    />
                                </button>
                            {/each}
                        </div>

                        {#if submitted}
                            <div
                                class={cn(
                                    "mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-md border px-3 py-2",
                                    correct
                                        ? "border-correct bg-correct/10"
                                        : "border-destructive bg-destructive/10",
                                )}
                            >
                                <div class="flex items-center gap-2">
                                    <Icon
                                        name={correct
                                            ? "check_circle"
                                            : "cancel"}
                                        class={correct
                                            ? "text-correct"
                                            : "text-destructive"}
                                    />
                                    <span class="text-sm font-medium">
                                        {correct ? "Correct" : "Not quite"}
                                    </span>
                                </div>
                                <span
                                    class="font-mono text-sm text-muted-foreground"
                                >
                                    {formatElapsed(elapsedMs)}
                                </span>
                            </div>
                        {/if}
                    </div>

                    <footer
                        class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"
                    >
                        <Button
                            variant="ghost"
                            disabled={submitted}
                            onclick={skipProblem}
                        >
                            <Icon name="skip_next" />
                            Skip
                        </Button>

                        {#if submitted}
                            <Button onclick={() => loadProblem()}>
                                Next
                                <Icon name="arrow_forward" />
                            </Button>
                        {:else}
                            <Button
                                disabled={selectedChoice == null}
                                onclick={submitAnswer}
                            >
                                Submit
                            </Button>
                        {/if}
                    </footer>
                {/if}
            </section>
        </main>

        {@render settingsPanel()}
    </div>
</div>
