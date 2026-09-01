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
    fetchSeriesNumberLine,
    type SeriesDimensionRow,
} from "$lib/series-review";
import type { OfflineRepository } from "$lib/offline/repository";
import type {
    LocalSubmissionV1,
    OfflinePackageManifestV1,
    OfflinePracticeProblemV1,
    PracticeQueryV1,
} from "$lib/offline/types";
import { BROWSE_INTENT } from "$lib/offline/types";

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
    getSeriesNumberLine(
        seriesId: number,
        scope?: { divisions: string[]; formats: string[] },
    ): Promise<number>;
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
        getSeriesNumberLine: (seriesId, scope) =>
            fetchSeriesNumberLine(supabase, seriesId, scope),
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
    if (input.manifest.sessionId == null) {
        throw new Error("This download has no dedicated session. Open Practice to start a local one.");
    }
    return createDownloadedTrainerDataSource({
        repository: input.repository,
        manifests: [input.manifest],
        sessionId: input.manifest.sessionId,
    });
}

/** Normal local Practice: packets are storage provenance, not a user-facing catalog. */
export function createDownloadedTrainerDataSource(input: {
    repository: OfflineRepository;
    manifests: OfflinePackageManifestV1[];
    sessionId: number;
}): TrainerDataSource {
    const { repository, manifests, sessionId } = input;
    const editableSettings = sessionId < 0;
    const manifest = manifests[0];
    if (!manifest) throw new Error("No downloaded practice is ready.");
    const manifestsById = new Map(manifests.map((item) => [item.packageId, item]));
    let catalogPlacements: OfflinePracticeProblemV1["placements"] | null = null;

    async function placements() {
        if (catalogPlacements) return catalogPlacements;
        const result = await repository.browseProblems({
            version: 1,
            intent: BROWSE_INTENT,
            userId: manifest.userId,
            packageIds: manifests.map((item) => item.packageId),
            filters: {},
            offset: 0,
            limit: Number.MAX_SAFE_INTEGER,
        });
        catalogPlacements = result.status === "ok"
            ? result.problems.map((item) => item.placement)
            : [];
        return catalogPlacements;
    }

    async function identity(problemId?: number) {
        const loaded = await repository.loadSession(manifest.userId, sessionId);
        if (!loaded) throw new Error("Downloaded practice session not found.");
        let source = manifest;
        if (problemId != null) {
            const found = await entry(problemId);
            const sourceId = found?.sourcePackageIds[0];
            if (sourceId) source = manifestsById.get(sourceId) ?? source;
        }
        return {
            userId: manifest.userId,
            packageId: source.packageId,
            checkoutId: source.checkoutId,
            sessionId,
            clientSessionId: loaded.clientSessionId,
        };
    }

    async function entry(problemId: number): Promise<OfflinePracticeProblemV1 | null> {
        return repository.getProblem({
            userId: manifest.userId,
            packageIds: manifests.map((item) => item.packageId),
            canonicalId: problemId,
        });
    }

    return {
        kind: "offline",
        capabilities: editableSettings
            ? Object.freeze({ ...OFFLINE_TRAINER_CAPABILITIES, settings: true })
            : OFFLINE_TRAINER_CAPABILITIES,
        async queryProblems({ settings, session, ratingCenter }) {
            if (settings.mode !== "new" || settings.format !== "practice") {
                throw new Error("Downloaded practice currently supports New mode only.");
            }
            const adaptive = settings.adaptive ?? true;
            const range = settings.adaptiveRange ?? ADAPTIVE_RANGE_DEFAULT;
            const query = {
                version: 1,
                intent: "practice-new",
                userId: manifest.userId,
                packageIds: manifests.map((item) => item.packageId),
                sessionId,
                mode: "new",
                filters: {
                    topic: [...settings.topic],
                    seriesIds: [...(settings.seriesIds ?? [])],
                    seriesScopes: Object.fromEntries(
                        Object.entries(settings.seriesScopes ?? {}).map(([id, scope]) => [
                            id,
                            {
                                divisions: [...scope.divisions],
                                formats: [...scope.formats],
                                ...(scope.problemNumbers
                                    ? {
                                          problemNumbers: [
                                              scope.problemNumbers[0],
                                              scope.problemNumbers[1],
                                          ] as [number, number],
                                      }
                                    : {}),
                            },
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
                          seed: `${manifests.map((item) => item.packageRevision).join(":")}:${sessionId}`,
                          ratingCenter,
                      }
                    : {
                          kind: "seeded-random",
                          seed: `${manifests.map((item) => item.packageRevision).join(":")}:${sessionId}`,
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
        getPlayerRating: () => repository.getPlayerRating(manifest.userId, sessionId),
        async loadSession() {
            return repository.loadSession(manifest.userId, sessionId);
        },
        async getSeriesOptions() {
            const found = new Map<string, string>();
            for (const placement of await placements()) {
                if (placement.series) {
                    found.set(String(placement.series.id), placement.series.name);
                }
            }
            return [...found].map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label));
        },
        async getSeriesDimensions(seriesId) {
            return (await placements())
                .filter((placement) => placement.series?.id === seriesId)
                .map((placement) => ({
                    division: placement.test?.division ?? null,
                    division_order: null,
                    format: placement.test?.format ?? null,
                    format_order: null,
                }));
        },
        async getSeriesNumberLine(seriesId, scope) {
            let max = -1;
            for (const placement of await placements()) {
                if (placement.series?.id !== seriesId) continue;
                if (
                    scope?.divisions.length &&
                    (!placement.test?.division ||
                        !scope.divisions.includes(placement.test.division))
                ) {
                    continue;
                }
                if (
                    scope?.formats.length &&
                    (!placement.test?.format ||
                        !scope.formats.includes(placement.test.format))
                ) {
                    continue;
                }
                if (placement.problemNumber > max) max = placement.problemNumber;
            }
            return max >= 0 ? max + 1 : 0;
        },
        async getSessionProblemIds() {
            const loaded = await repository.loadSession(manifest.userId, sessionId);
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
        async updateSettings(settings) {
            if (!editableSettings) {
                throw new Error("Legacy downloaded-session settings are fixed.");
            }
            await repository.updateSessionSettings(manifest.userId, sessionId, settings);
        },
        async recordSubmission(submission) {
            const local = await repository.recordSubmission({
                ...(await identity(submission.problemId)),
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
                ...(await identity(problemId)),
                canonicalId: problemId,
                mastery,
                dependsOn,
            });
        },
        async setEngagement(problemId, engagement, dependsOn) {
            await repository.setEngagement({
                ...(await identity(problemId)),
                canonicalId: problemId,
                engagement,
                dependsOn,
            });
        },
        async setCurrentProblem(problemId, elapsedMs) {
            await repository.setCurrentProblem({
                userId: manifest.userId,
                sessionId,
                canonicalId: problemId,
                elapsedMs,
            });
        },
        async finishSession() {
            await repository.finishSession(await identity());
        },
        async syncVersion() {
            return (await repository.listPackages(manifest.userId))
                .map((item) => item.lastSyncedAt)
                .filter((value): value is string => value != null)
                .sort()
                .at(-1) ?? null;
        },
    };
}
