import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import {
    fetchByIds,
    fetchAllSeries,
    fetchPlayerRating,
    type PlayerRating,
    type ProblemRating,
    type ProblemRow,
} from "$lib/library";
import {
    recordSubmission as recordOnlineSubmission,
    setProblemEngagement,
    setProblemMastery,
    type Engagement,
    type Mastery,
    type ProblemProgress,
    type SubmissionInput,
} from "$lib/progress";
import {
    endSession,
    fetchSession,
    fetchSessionHistory,
    fetchOlderSubmission,
    fetchSessionProblemIds,
    getOrCreateRootSession,
    setCurrentProblem as setOnlineCurrentProblem,
    updateSessionSettings,
    type OlderSubmission,
    type PracticeSessionRow,
    type SessionHistoryEntry,
} from "$lib/sessions";
import {
    ADAPTIVE_RANGE_DEFAULT,
    RATING_RANGE,
    nextPracticeProblem,
    fetchTestProblems,
    type PracticeResult,
    type PracticeMode,
    type PracticeSession,
    type PracticeSettings,
    type SessionFormat,
} from "$lib/trainer";
import {
    fetchSeriesDimensions,
    type SeriesDimensionRow,
} from "$lib/series-review";
import type { OfflineRepository } from "$lib/offline/repository";
import type {
    LocalSubmissionV1,
    OfflinePackageManifestV1,
    OfflinePracticeProblemV1,
    PracticeQueryV1,
} from "$lib/offline/types";

type Supabase = SupabaseClient<Database>;

export type TrainerLoadedSession = {
    row: PracticeSessionRow;
    localSubmissions: LocalSubmissionV1[];
};

export type TrainerProblem = {
    problem: ProblemRow;
    progress: ProblemProgress | null;
    rating: ProblemRating | null;
};

export type TrainerSubmissionResult = {
    submissionId: number | null;
    operationId: string | null;
};

export type TrainerTestSubmissionInput = Omit<
    SubmissionInput,
    "source" | "sessionId"
>;

export type TrainerCapabilities = Readonly<{
    modes: Readonly<Record<PracticeMode, boolean>>;
    formats: Readonly<Record<SessionFormat, boolean>>;
    answer: boolean;
    skip: boolean;
    back: boolean;
    mastery: boolean;
    engagement: boolean;
    adaptive: boolean;
    settings: boolean;
    coach: boolean;
    discuss: boolean;
    sourceLinks: boolean;
    problemReports: boolean;
    serverHistory: boolean;
}>;

const ALL_MODES = Object.freeze({
    new: true,
    review: true,
    skipped: true,
    list: true,
    mixed: true,
}) satisfies Readonly<Record<PracticeMode, boolean>>;

const NEW_MODE_ONLY = Object.freeze({
    new: true,
    review: false,
    skipped: false,
    list: false,
    mixed: false,
}) satisfies Readonly<Record<PracticeMode, boolean>>;

export const ONLINE_TRAINER_CAPABILITIES: TrainerCapabilities = Object.freeze({
    modes: ALL_MODES,
    formats: Object.freeze({ practice: true, test: true }),
    answer: true,
    skip: true,
    back: true,
    mastery: true,
    engagement: true,
    adaptive: true,
    settings: true,
    coach: true,
    discuss: true,
    sourceLinks: true,
    problemReports: true,
    serverHistory: true,
});

export const OFFLINE_TRAINER_CAPABILITIES: TrainerCapabilities = Object.freeze({
    modes: NEW_MODE_ONLY,
    formats: Object.freeze({ practice: true, test: false }),
    answer: true,
    skip: true,
    back: true,
    mastery: true,
    engagement: true,
    adaptive: true,
    settings: false,
    coach: false,
    discuss: false,
    sourceLinks: false,
    problemReports: false,
    serverHistory: false,
});

/**
 * The trainer's data boundary. Components choose one implementation once and
 * then speak only in domain operations; PostgREST never leaks into IndexedDB.
 */
export interface TrainerDataSource {
    readonly kind: "online" | "offline";
    readonly capabilities: TrainerCapabilities;
    queryProblems(input: {
        settings: PracticeSettings;
        session: PracticeSession;
        ratingCenter: number | null;
    }): Promise<PracticeResult>;
    getProblem(problemId: number): Promise<TrainerProblem | null>;
    getEffectiveProgress(problemId: number): Promise<ProblemProgress | null>;
    getPlayerRating(): Promise<PlayerRating | null>;
    loadSession(): Promise<TrainerLoadedSession | null>;
    getSeriesOptions(): Promise<{ value: string; label: string }[]>;
    getSeriesDimensions(seriesId: number): Promise<SeriesDimensionRow[]>;
    getSessionProblemIds(): Promise<number[]>;
    getOlderSubmission(beforeId: number | null): Promise<OlderSubmission | null>;
    getSessionHistory(): Promise<SessionHistoryEntry[]>;
    getTestProblems(testId: number): Promise<ProblemRow[]>;
    recordTestSubmissions(inputs: TrainerTestSubmissionInput[]): Promise<void>;
    updateSettings(settings: PracticeSettings): Promise<void>;
    recordSubmission(input: SubmissionInput): Promise<TrainerSubmissionResult>;
    setMastery(problemId: number, mastery: Mastery | null, dependsOn?: string[]): Promise<void>;
    setEngagement(
        problemId: number,
        engagement: Engagement | null,
        dependsOn?: string[],
    ): Promise<void>;
    setCurrentProblem(problemId: number | null, elapsedMs: number): Promise<void>;
    finishSession(): Promise<void>;
    /** Advances only when authoritative sync state was applied locally. */
    syncVersion(): Promise<string | null>;
}

export function createOnlineTrainerDataSource(input: {
    supabase: Supabase;
    userId: string | null;
    sessionParam: string;
}): TrainerDataSource {
    const { supabase, userId, sessionParam } = input;
    let loadedSession: PracticeSessionRow | null = null;

    async function requireSession(): Promise<PracticeSessionRow> {
        if (loadedSession) return loadedSession;
        if (!userId) throw new Error("A signed-in user is required for a saved session");
        const row = sessionParam === "root"
            ? await getOrCreateRootSession(supabase, userId)
            : await fetchSession(supabase, Number(sessionParam));
        if (!row) throw new Error("Practice session not found");
        loadedSession = row;
        return row;
    }

    async function problem(problemId: number): Promise<TrainerProblem | null> {
        const rows = await fetchByIds(supabase, "problems", [problemId]);
        const row = rows[0] as ProblemRow | undefined;
        return row
            ? { problem: row, progress: row.progress ?? null, rating: row.rating ?? null }
            : null;
    }

    return {
        kind: "online",
        capabilities: ONLINE_TRAINER_CAPABILITIES,
        queryProblems: ({ settings, session, ratingCenter }) =>
            nextPracticeProblem(supabase, settings, session, ratingCenter),
        getProblem: problem,
        async getEffectiveProgress(problemId) {
            return (await problem(problemId))?.progress ?? null;
        },
        getPlayerRating: () => userId ? fetchPlayerRating(supabase, userId) : Promise.resolve(null),
        async loadSession() {
            if (!userId) return null;
            return { row: await requireSession(), localSubmissions: [] };
        },
        async getSeriesOptions() {
            return (await fetchAllSeries(supabase)).map((series) => ({
                value: String(series.id),
                label: series.name,
            }));
        },
        getSeriesDimensions: (seriesId) => fetchSeriesDimensions(supabase, seriesId),
        async getSessionProblemIds() {
            if (!userId) return [];
            return fetchSessionProblemIds(supabase, (await requireSession()).id);
        },
        async getOlderSubmission(beforeId) {
            if (!userId) return null;
            return fetchOlderSubmission(supabase, (await requireSession()).id, beforeId);
        },
        async getSessionHistory() {
            if (!userId) return [];
            return fetchSessionHistory(supabase, (await requireSession()).id);
        },
        getTestProblems: (testId) => fetchTestProblems(supabase, testId),
        async recordTestSubmissions(inputs) {
            if (!userId || inputs.length === 0) return;
            const session = await requireSession();
            const { error } = await supabase.from("submissions").insert(
                inputs.map((entry) => ({
                    user_id: userId,
                    problem_id: entry.problemId,
                    selected_choice: entry.selectedChoice,
                    answer: entry.answer ?? null,
                    is_correct: entry.isCorrect,
                    skipped: entry.skipped,
                    flagged: entry.flagged,
                    elapsed_ms: entry.elapsedMs,
                    tries_used: entry.triesUsed ?? 0,
                    source: "test",
                    session_id: session.id,
                })),
            );
            if (error && error.code !== "23505") throw error;
        },
        async updateSettings(settings) {
            await updateSessionSettings(supabase, (await requireSession()).id, settings);
        },
        async recordSubmission(submission) {
            if (!userId) return { submissionId: null, operationId: null };
            return {
                submissionId: await recordOnlineSubmission(supabase, userId, submission),
                operationId: null,
            };
        },
        async setMastery(problemId, mastery) {
            await setProblemMastery(supabase, problemId, mastery);
        },
        async setEngagement(problemId, engagement) {
            await setProblemEngagement(supabase, problemId, engagement);
        },
        async setCurrentProblem(problemId, elapsedMs) {
            await setOnlineCurrentProblem(supabase, (await requireSession()).id, problemId, elapsedMs);
        },
        async finishSession() {
            await endSession(supabase, (await requireSession()).id);
        },
        async syncVersion() {
            return null;
        },
    };
}

function manualRatingBand(difficulty: [number, number]): [number, number] | null {
    const lo = Math.max(difficulty[0], RATING_RANGE[0]);
    const hi = Math.min(difficulty[1], RATING_RANGE[1]);
    if (difficulty[1] < RATING_RANGE[0] || lo > hi) return null;
    return lo <= RATING_RANGE[0] && hi >= RATING_RANGE[1] ? null : [lo, hi];
}

/** Convert normalized downloaded data into the row shape the trainer renders. */
export function offlineProblemRow(entry: OfflinePracticeProblemV1): ProblemRow {
    const source = entry.problem;
    const placement = entry.placements[0] ?? null;
    return {
        id: entry.canonicalId,
        canonical_id: null,
        sync_key: null,
        test_id: placement?.testId ?? null,
        n: placement?.problemNumber ?? 0,
        statement: source.statement,
        topic: source.topic,
        choices: source.choices,
        answer_index: source.answerIndex,
        answer_status: source.answerStatus,
        official_solutions: source.officialSolutions,
        verified: source.verified,
        is_computational: source.isComputational,
        response_kind: source.responseKind,
        aops_id: source.aopsId,
        tags: source.tags,
        difficulty: source.difficulty,
        quality: source.quality,
        notes: source.notes,
        built_at: source.builtAt,
        tests: placement?.test
            ? {
                  name: placement.test.name,
                  series_id: placement.test.seriesId,
                  series: placement.series ? { name: placement.series.name } : null,
                  aops_category_id: placement.test.aopsCategoryId,
                  division: placement.test.division,
                  format: placement.test.format,
              }
            : null,
        progress: entry.progress,
        rating: entry.rating
            ? { rating: entry.rating.rating, rd: entry.rating.rd, attempts: entry.rating.attempts }
            : null,
    };
}

export function createOfflineTrainerDataSource(input: {
    repository: OfflineRepository;
    manifest: OfflinePackageManifestV1;
}): TrainerDataSource {
    const { repository, manifest } = input;
    const identity = {
        userId: manifest.userId,
        packageId: manifest.packageId,
        checkoutId: manifest.checkoutId,
        sessionId: manifest.sessionId,
    };

    async function entry(problemId: number): Promise<OfflinePracticeProblemV1 | null> {
        return repository.getProblem({
            userId: manifest.userId,
            packageIds: [manifest.packageId],
            canonicalId: problemId,
        });
    }

    return {
        kind: "offline",
        capabilities: OFFLINE_TRAINER_CAPABILITIES,
        async queryProblems({ settings, session, ratingCenter }) {
            if (settings.mode !== "new" || settings.format !== "practice") {
                throw new Error("Downloaded practice currently supports New mode only.");
            }
            const adaptive = settings.adaptive ?? true;
            const range = settings.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT;
            const query = {
                version: 1,
                userId: manifest.userId,
                packageIds: [manifest.packageId],
                sessionId: manifest.sessionId,
                mode: "new",
                filters: {
                    topic: [...settings.topic],
                    seriesIds: [...(settings.seriesIds ?? [])],
                    seriesScopes: Object.fromEntries(
                        Object.entries(settings.seriesScopes ?? {}).map(([id, scope]) => [
                            id,
                            { divisions: [...scope.divisions], formats: [...scope.formats] },
                        ]),
                    ),
                    ratingBand: adaptive && ratingCenter != null
                        ? [ratingCenter - range, ratingCenter + range] as [number, number]
                        : adaptive
                          ? null
                          : manualRatingBand(settings.difficulty),
                    verifiedOnly: settings.verifiedOnly,
                    computational: settings.computational,
                    answerAvailability: settings.answerAvailability ?? "with",
                    solutionAvailability: settings.solutionAvailability ?? "any",
                    mastery: [...settings.mastery],
                },
                excludeCanonicalIds: [...session.shownIds],
                order: adaptive
                    ? {
                          kind: "nearest-rating",
                          seed: `${manifest.packageRevision}:${manifest.sessionId}`,
                          ratingCenter,
                      }
                    : {
                          kind: "seeded-random",
                          seed: `${manifest.packageRevision}:${manifest.sessionId}`,
                          ratingCenter: null,
                      },
                limit: 1,
            } satisfies PracticeQueryV1;
            const result = await repository.queryProblems(query);
            if (result.status !== "ok") {
                if (result.status === "not_downloaded") {
                    throw new Error("Those filters include content that was not downloaded.");
                }
                if (result.status === "package_unavailable") {
                    throw new Error("This download is not ready for offline practice.");
                }
                return { problem: null, source: "practice", progress: null };
            }
            const selected = result.problems[0];
            return {
                problem: offlineProblemRow(selected),
                source: "practice",
                progress: selected.progress,
            };
        },
        async getProblem(problemId) {
            const found = await entry(problemId);
            return found
                ? {
                      problem: offlineProblemRow(found),
                      progress: found.progress,
                      rating: found.rating
                          ? {
                                rating: found.rating.rating,
                                rd: found.rating.rd,
                                attempts: found.rating.attempts,
                            }
                          : null,
                  }
                : null;
        },
        async getEffectiveProgress(problemId) {
            return (await entry(problemId))?.progress ?? null;
        },
        getPlayerRating: () => repository.getPlayerRating(manifest.userId, manifest.sessionId),
        async loadSession() {
            return repository.loadSession(manifest.userId, manifest.sessionId);
        },
        async getSeriesOptions() {
            return [];
        },
        async getSeriesDimensions() {
            return [];
        },
        async getSessionProblemIds() {
            const loaded = await repository.loadSession(manifest.userId, manifest.sessionId);
            return loaded?.localSubmissions.map((submission) => submission.canonicalId) ?? [];
        },
        async getOlderSubmission() {
            return null;
        },
        async getSessionHistory() {
            return [];
        },
        async getTestProblems() {
            throw new Error("Tests are unavailable in downloaded practice.");
        },
        async recordTestSubmissions() {
            throw new Error("Tests are unavailable in downloaded practice.");
        },
        async updateSettings() {
            throw new Error("Offline practice settings are fixed to the downloaded session.");
        },
        async recordSubmission(submission) {
            const local = await repository.recordSubmission({
                ...identity,
                canonicalId: submission.problemId,
                selectedChoice: submission.selectedChoice,
                answer: submission.answer ?? null,
                isCorrect: submission.isCorrect,
                skipped: submission.skipped,
                flagged: submission.flagged,
                elapsedMs: submission.elapsedMs,
                triesUsed: submission.triesUsed ?? 0,
            });
            return { submissionId: null, operationId: local.operationId };
        },
        async setMastery(problemId, mastery, dependsOn) {
            await repository.setMastery({
                ...identity,
                canonicalId: problemId,
                mastery,
                dependsOn,
            });
        },
        async setEngagement(problemId, engagement, dependsOn) {
            await repository.setEngagement({
                ...identity,
                canonicalId: problemId,
                engagement,
                dependsOn,
            });
        },
        async setCurrentProblem(problemId, elapsedMs) {
            await repository.setCurrentProblem({
                userId: manifest.userId,
                sessionId: manifest.sessionId,
                canonicalId: problemId,
                elapsedMs,
            });
        },
        async finishSession() {
            await repository.finishSession(identity);
        },
        async syncVersion() {
            const current = (await repository.listPackages(manifest.userId)).find(
                (item) => item.packageId === manifest.packageId,
            );
            return current?.lastSyncedAt ?? null;
        },
    };
}
