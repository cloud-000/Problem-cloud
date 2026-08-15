import { describe, expect, test } from "bun:test";
import { defaultPracticeSettings, createSession } from "$lib/trainer";
import { createMemoryStorage } from "$lib/offline/memory";
import { OfflineRepository } from "$lib/offline/repository";
import {
    buildFixturePackage,
    GEOMETRY_SCOPE,
    OVERLAP_SCOPE,
    geometryFixtureProblems,
    overlappingFixtureProblems,
    installFixturePackage,
} from "$lib/offline/fixtures";
import {
    createDownloadedTrainerDataSource,
    createOfflineTrainerDataSource,
} from "$lib/trainer-data-source";
import { bindOfflinePracticePackage } from "$lib/offline/practice-binding";

const USER = "00000000-0000-4000-8000-0000000000aa";

async function ready() {
    const repository = new OfflineRepository({ storage: createMemoryStorage() });
    const fixture = await buildFixturePackage({
        userId: USER,
        scope: GEOMETRY_SCOPE,
        problems: geometryFixtureProblems(),
    });
    await installFixturePackage(repository, fixture, USER);
    const manifest = (await repository.listPackages(USER))[0];
    return {
        repository,
        manifest,
        source: createOfflineTrainerDataSource({ repository, manifest }),
    };
}

describe("offline trainer data source", () => {
    test("normal local Practice draws from the union and keeps checkout provenance", async () => {
        const repository = new OfflineRepository({ storage: createMemoryStorage() });
        const geometry = await buildFixturePackage({
            userId: USER,
            scope: GEOMETRY_SCOPE,
            problems: geometryFixtureProblems(),
        });
        const overlap = await buildFixturePackage({
            userId: USER,
            scope: OVERLAP_SCOPE,
            problems: overlappingFixtureProblems(),
        });
        await installFixturePackage(repository, geometry, USER);
        await installFixturePackage(repository, overlap, USER);
        const session = await repository.createLocalSession(USER, {
            name: null,
            settings: defaultPracticeSettings(),
        });
        const manifests = await repository.listPackages(USER);
        const source = createDownloadedTrainerDataSource({
            repository,
            manifests,
            sessionId: session.id,
        });

        expect(source.capabilities.settings).toBe(true);
        const changedSettings = {
            ...defaultPracticeSettings(),
            topic: ["A"],
            adaptive: false,
        };
        await source.updateSettings(changedSettings);
        expect((await source.loadSession())?.row.settings).toEqual(changedSettings);
        expect((await source.getSeriesOptions()).map((option) => option.label)).toEqual([
            "AMC 10",
            "AMC 8",
        ]);

        const algebra = await source.getProblem(201);
        expect(algebra?.problem.topic).toBe("A");
        await source.recordSubmission({
            problemId: 201,
            selectedChoice: null,
            answer: "3",
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 500,
            source: "practice",
            sessionId: session.id,
            triesUsed: 1,
        });
        const [operation] = await repository.pendingOperations(USER, 10);
        const overlapManifest = manifests.find((item) => item.packageId === overlap.created.packageId);
        expect(operation.packageId).toBe(overlapManifest?.packageId);
        expect(operation.clientSessionId).toBe(
            (await repository.loadSession(USER, session.id))?.clientSessionId,
        );
    });

    test("characterizes the first shared-Practice capability boundary", async () => {
        const { source } = await ready();
        expect(source.capabilities).toEqual({
            modes: {
                new: true,
                review: false,
                skipped: false,
                list: false,
                mixed: false,
            },
            formats: { practice: true, test: false },
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
        expect(Object.isFrozen(source.capabilities)).toBe(true);
        expect(Object.isFrozen(source.capabilities.modes)).toBe(true);
    });

    test("runs New mode and resumes the dedicated local session", async () => {
        const { source, manifest } = await ready();
        const loaded = await source.loadSession();
        expect(loaded?.row.id).toBe(manifest.sessionId!);

        const result = await source.queryProblems({
            settings: defaultPracticeSettings(),
            session: createSession(),
            ratingCenter: (await source.getPlayerRating())?.rating ?? null,
        });
        expect(result.problem).not.toBeNull();
        expect(result.progress).toBeNull();
    });

    test("routes atomic writes and effective state through the repository", async () => {
        const { source, manifest, repository } = await ready();
        const session = createSession();
        const result = await source.queryProblems({
            settings: defaultPracticeSettings(),
            session,
            ratingCenter: 1200,
        });
        const problem = result.problem!;
        const recorded = await source.recordSubmission({
            problemId: problem.id,
            selectedChoice: null,
            answer: "7",
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 900,
            source: "practice",
            sessionId: manifest.sessionId!,
            triesUsed: 0,
        });
        expect(recorded.submissionId).toBeNull();
        expect(recorded.operationId).not.toBeNull();

        await source.setMastery(
            problem.id,
            "confident",
            recorded.operationId ? [recorded.operationId] : undefined,
        );
        expect((await source.getEffectiveProgress(problem.id))?.mastery).toBe(
            "confident",
        );

        await source.finishSession();
        expect((await source.loadSession())?.row.status).toBe("ended");
        expect(await repository.pendingOperations(USER, 100)).toHaveLength(3);
    });

    test("preserves current problem, local exclusions, and write dependencies across mounts", async () => {
        const { source, manifest, repository } = await ready();
        const settings = defaultPracticeSettings();
        const first = await source.queryProblems({
            settings,
            session: createSession(),
            ratingCenter: 1200,
        });
        await source.setCurrentProblem(first.problem!.id, 1234);

        const rebound = await bindOfflinePracticePackage(
            repository,
            manifest.packageId,
            manifest.userId,
        );
        const resumed = await rebound.source.loadSession();
        expect(resumed?.row.current_problem_id).toBe(first.problem!.id);
        expect(resumed?.row.current_elapsed_ms).toBe(1234);

        const recorded = await rebound.source.recordSubmission({
            problemId: first.problem!.id,
            selectedChoice: null,
            answer: "7",
            isCorrect: true,
            skipped: false,
            flagged: false,
            elapsedMs: 1500,
            source: "practice",
            sessionId: manifest.sessionId!,
            triesUsed: 0,
        });
        await rebound.source.setEngagement(
            first.problem!.id,
            "revisit",
            recorded.operationId ? [recorded.operationId] : undefined,
        );

        const after = await rebound.source.loadSession();
        expect(after?.row.current_problem_id).toBeNull();
        expect(after?.localSubmissions.map((row) => row.canonicalId)).toContain(
            first.problem!.id,
        );
        expect((await rebound.source.getEffectiveProgress(first.problem!.id))?.engagement)
            .toBe("revisit");
    });

    test("refuses unsupported modes instead of silently querying New", async () => {
        const { source } = await ready();
        await expect(
            source.queryProblems({
                settings: { ...defaultPracticeSettings(), mode: "review" },
                session: createSession(),
                ratingCenter: 1200,
            }),
        ).rejects.toThrow("New mode only");
    });

    test("reports authoritative sync advancement without exposing a network read", async () => {
        const { source } = await ready();
        expect(await source.syncVersion()).toBeNull();
    });
});
