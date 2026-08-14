<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer, ProblemSolution } from "$lib/components/problem";
    import { ProblemOrganization } from "$lib/components/problem-organization";
    import { topicLabel, type PlayerRating, type ProblemRating, type ProblemRow } from "$lib/library";
    import type { Mastery, ProblemProgress } from "$lib/progress";
    import { hasComparableAnswer, inputModeFor, resolveResponseKind } from "$lib/problem-response";
    import { createSession, type PracticeSettings } from "$lib/trainer";
    import {
        createOfflineTrainerDataSource,
        type TrainerDataSource,
    } from "$lib/trainer-data-source";
    import type { OfflineRepository } from "$lib/offline/repository";
    import { advanceShadowRating } from "$lib/offline/shadow";
    import type { OfflinePackageManifestV1 } from "$lib/offline/types";
    import { answersMatch } from "$lib/utils/answer-matcher";
    import { isMultipleChoice } from "$lib/utils";

    let {
        repository,
        manifest,
        onExit,
    }: {
        repository: OfflineRepository;
        manifest: OfflinePackageManifestV1;
        onExit: () => void;
    } = $props();

    // The parent keys this component by the chosen package. Its data source is
    // intentionally selected once for that mount, never switched operation by
    // operation as connectivity changes.
    const initial = untrack(() => ({ repository, manifest }));
    const source: TrainerDataSource = createOfflineTrainerDataSource(initial);
    const drawSession = createSession();

    type RunEntry = {
        problem: ProblemRow;
        progress: ProblemProgress | null;
        rating: ProblemRating | null;
        answer: string;
        selectedChoice: number | null;
        submitted: boolean;
        correct: boolean | null;
        skipped: boolean;
        elapsedMs: number;
        operationId: string | null;
    };

    let settings = $state<PracticeSettings | null>(null);
    let entries = $state<RunEntry[]>([]);
    let index = $state(-1);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let exhausted = $state(false);
    let startedAt = $state(Date.now());
    let downloadedPlayer = $state<PlayerRating | null>(null);
    let selectionPlayer = $state<PlayerRating | null>(null);
    let shadow = $state<number | null>(null);
    let syncVersion = $state<string | null>(initial.manifest.lastSyncedAt);
    let saving = $state(false);

    let current = $derived(entries[index] ?? null);
    let problem = $derived(current?.problem ?? null);
    let responseMode = $derived(problem ? inputModeFor(resolveResponseKind(problem)) : "unsupported");
    let multipleChoice = $derived(problem ? isMultipleChoice(problem.choices) : false);
    let canSubmit = $derived(
        Boolean(current && !current.submitted) &&
            (multipleChoice
                ? current?.selectedChoice != null
                : Boolean(current?.answer.trim())),
    );
    let suggestedMastery = $derived<Mastery>(
        current?.correct ? "confident" : "needs_work",
    );

    function elapsed(): number {
        return Math.max(0, Date.now() - startedAt);
    }

    async function resetShadowAfterSync() {
        const latest = await source.syncVersion();
        if (latest === syncVersion) return;
        syncVersion = latest;
        selectionPlayer = await source.getPlayerRating();
        shadow = selectionPlayer?.rating ?? null;
    }

    async function show(problemId: number, elapsedMs = 0) {
        const loaded = await source.getProblem(problemId);
        if (!loaded) return false;
        drawSession.shownIds.add(loaded.problem.id);
        entries = [
            ...entries,
            {
                problem: loaded.problem,
                progress: loaded.progress,
                rating: loaded.rating,
                answer: "",
                selectedChoice: null,
                submitted: false,
                correct: null,
                skipped: false,
                elapsedMs,
                operationId: null,
            },
        ];
        index = entries.length - 1;
        startedAt = Date.now() - elapsedMs;
        return true;
    }

    async function loadNext() {
        if (!settings || loading) return;
        loading = true;
        error = null;
        try {
            await resetShadowAfterSync();
            const result = await source.queryProblems({
                settings,
                session: drawSession,
                ratingCenter: shadow,
            });
            if (!result.problem) {
                exhausted = true;
                return;
            }
            exhausted = false;
            await show(result.problem.id);
            await source.setCurrentProblem(result.problem.id, 0);
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            loading = false;
        }
    }

    function grade(): boolean | null {
        if (!current || !problem) return null;
        if (!hasComparableAnswer(problem)) return null;
        if (multipleChoice) return current.selectedChoice === problem.answer_index;
        const answerIndex = problem.answer_index ?? 0;
        const reference = problem.choices?.[answerIndex] ?? "";
        return answersMatch(current.answer, reference);
    }

    async function saveSubmission(skipped: boolean) {
        if (!current || !problem || current.submitted || saving) return;
        saving = true;
        error = null;
        const isCorrect = skipped ? null : grade();
        const elapsedMs = elapsed();
        try {
            const recorded = await source.recordSubmission({
                problemId: problem.id,
                selectedChoice: skipped ? null : current.selectedChoice,
                answer: skipped || multipleChoice ? null : current.answer,
                isCorrect,
                skipped,
                flagged: false,
                elapsedMs,
                source: "practice",
                sessionId: manifest.sessionId,
                triesUsed: 0,
            });
            current.submitted = true;
            current.correct = isCorrect;
            current.skipped = skipped;
            current.elapsedMs = elapsedMs;
            current.operationId = recorded.operationId;
            current.progress = await source.getEffectiveProgress(problem.id);
            await source.setCurrentProblem(null, 0);

            if (
                isCorrect !== null &&
                shadow !== null &&
                selectionPlayer &&
                current.rating
            ) {
                shadow = advanceShadowRating(
                    shadow,
                    selectionPlayer,
                    current.rating,
                    isCorrect,
                );
            }
            if (skipped) await loadNext();
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            saving = false;
        }
    }

    async function finish() {
        if (saving) return;
        saving = true;
        try {
            await source.finishSession();
            onExit();
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            saving = false;
        }
    }

    onMount(async () => {
        try {
            const loaded = await source.loadSession();
            if (!loaded) throw new Error("The downloaded practice session is unavailable.");
            settings = loaded.row.settings as unknown as PracticeSettings;
            // The package endpoint accepts only New/practice settings. Refuse a
            // contradictory local row rather than silently running another mode.
            if (settings.mode !== "new" || settings.format !== "practice") {
                throw new Error("This download is not a New-mode practice session.");
            }
            for (const submission of loaded.localSubmissions) {
                drawSession.shownIds.add(submission.canonicalId);
            }
            downloadedPlayer = await source.getPlayerRating();
            selectionPlayer = downloadedPlayer;
            shadow = downloadedPlayer?.rating ?? null;
            if (
                loaded.row.current_problem_id != null &&
                (await show(
                    loaded.row.current_problem_id,
                    loaded.row.current_elapsed_ms ?? 0,
                ))
            ) {
                loading = false;
                return;
            }
            loading = false;
            await loadNext();
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
            loading = false;
        }
    });

    $effect(() => {
        if (!problem || current?.submitted) return;
        const problemId = problem.id;
        const timer = setInterval(() => {
            void source.setCurrentProblem(problemId, elapsed()).catch(() => undefined);
        }, 5000);
        return () => clearInterval(timer);
    });
</script>

<section class="flex min-h-[70vh] flex-col" aria-label="Offline practice">
    <div class="border-border flex flex-wrap items-center gap-2 border-b pb-sm">
        <Button size="sm" variant="ghost" onclick={onExit} aria-label="Back to downloads">
            <Icon name="arrow_back" /> Downloads
        </Button>
        <div>
            <h1 class="text-base font-semibold">Offline New mode</h1>
            <p class="text-muted-foreground type-caption">
                {manifest.problemCount} downloaded problems
                {#if downloadedPlayer}
                    · downloaded rating {Math.round(downloadedPlayer.rating)} (stale)
                {/if}
            </p>
        </div>
        <Button class="ml-auto" size="sm" variant="outline" onclick={finish} disabled={saving}>
            Finish session
        </Button>
    </div>

    <div class="bg-surface-container-low mt-sm rounded-md px-sm py-2 text-xs text-muted-foreground">
        Coach and source links need a network connection, so they are unavailable in offline practice.
    </div>

    {#if loading}
        <div class="flex flex-1 items-center justify-center gap-2 py-xl text-muted-foreground">
            <Icon name="progress_activity" class="animate-spin" /> Loading from this device…
        </div>
    {:else if error}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 py-xl text-center">
            <Icon name="error" class="text-destructive" fontsize={24} />
            <p class="max-w-lg text-sm">{error}</p>
            <Button size="sm" onclick={loadNext}>Try again</Button>
        </div>
    {:else if exhausted || !current || !problem}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 py-xl text-center">
            <Icon name="task_alt" class="text-primary" fontsize={28} />
            <h2 class="font-semibold">No new downloaded problems remain</h2>
            <p class="text-muted-foreground type-secondary max-w-lg">
                Answered and skipped problems stay excluded after reload. Reconnect to sync them or finish this session.
            </p>
        </div>
    {:else}
        <div class="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-md py-lg">
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
                {#if problem.topic}<span>{topicLabel(problem.topic)}</span>{/if}
                {#if problem.tests?.name}<span>· {problem.tests.name} #{problem.n + 1}</span>{/if}
                <span class="ml-auto">New · {settings?.adaptive === false ? "seeded order" : "adaptive"}</span>
            </div>

            <MathStatement
                text={problem.statement ?? ""}
                class="font-serif text-lg leading-relaxed md:text-xl"
            />

            <ProblemAnswer
                choices={problem.choices}
                answerIndex={problem.answer_index}
                responseKind={problem.response_kind}
                answerStatus={problem.answer_status}
                bind:answer={current.answer}
                bind:selectedChoice={current.selectedChoice}
                showAnswerState={current.submitted}
                disabled={current.submitted || saving}
                onEnter={() => canSubmit && void saveSubmission(false)}
            />

            {#if current.submitted}
                <ProblemOrganization
                    problemId={problem.id}
                    mastery={current.progress?.mastery ?? null}
                    engagement={current.progress?.engagement ?? null}
                    prompt={current.correct !== null}
                    promptPresentation="persistent"
                    {suggestedMastery}
                    saveMastery={async (value) => {
                        await source.setMastery(
                            problem.id,
                            value,
                            current.operationId ? [current.operationId] : undefined,
                        );
                        current.progress = await source.getEffectiveProgress(problem.id);
                    }}
                    saveEngagement={async (value) => {
                        await source.setEngagement(
                            problem.id,
                            value,
                            current.operationId ? [current.operationId] : undefined,
                        );
                        current.progress = await source.getEffectiveProgress(problem.id);
                    }}
                />
                <ProblemSolution
                    solutions={problem.official_solutions}
                    defaultOpen={current.correct === false}
                />
            {/if}

            <div class="border-border mt-auto flex flex-wrap items-center gap-2 border-t pt-md">
                <Button
                    size="sm"
                    variant="ghost"
                    onclick={() => index--}
                    disabled={index <= 0 || saving}
                >
                    Back
                </Button>
                <Button size="sm" variant="ghost" disabled title="Coach needs a network connection">
                    <Icon name="auto_awesome" /> Coach unavailable offline
                </Button>
                <div class="ml-auto flex gap-2">
                    {#if current.submitted}
                        <Button size="sm" onclick={loadNext} disabled={saving}>Next</Button>
                    {:else}
                        <Button size="sm" variant="outline" onclick={() => saveSubmission(true)} disabled={saving}>
                            Skip
                        </Button>
                        <Button size="sm" onclick={() => saveSubmission(false)} disabled={!canSubmit || saving || responseMode === "unsupported"}>
                            Submit
                        </Button>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</section>
