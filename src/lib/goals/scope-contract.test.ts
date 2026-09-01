/**
 * The scope contract: the SQL resolver and the trainer's PostgREST filter must
 * select the same set for the same scope.
 *
 * `docs/goals.md` §3 keeps two implementations of scope matching on purpose —
 * Goals evaluates in SQL, while the trainer builds the same OR-of-ANDs as
 * PostgREST filters on a performance-sensitive draw path — and pins them
 * together with this test rather than by refactoring one into the other. SQL
 * owns the definition; if the two disagree, SQL is right and the client is the
 * bug. This mirrors how ratings already treats its client-side math.
 *
 * It needs the local Supabase stack, so it SKIPS when the stack is not running
 * rather than failing an otherwise-clean `bun test`. The keys below are the
 * published Supabase local-development defaults, identical in every project and
 * useless anywhere else; override them by env when a stack differs.
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { applySeriesScopeFilter, seriesScopeSelectAliases, type PracticeSettings } from "$lib/trainer";
import type { GoalScope } from "./types";

// Web APIs and the three bun:test exports only: `@types/bun` is not installed,
// so `node:crypto`, `process`, `Buffer`, and `beforeAll`/`afterAll` all fail
// `bun run check` even though they run fine. Keeping this file inside what the
// project type-checks is cheaper than taking on a types dependency for one test.
const URL = "http://127.0.0.1:54321";
const ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

const reachable = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: ANON_KEY },
    signal: AbortSignal.timeout(1500),
})
    .then((r) => r.ok)
    .catch(() => false);

function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * `goal_scope_canonicals` is granted to `authenticated` only, and both views it
 * reads are `security invoker` — so the contract has to be exercised through a
 * real user token, exactly as the app will.
 */
async function userToken(sub: string): Promise<string> {
    const encoder = new TextEncoder();
    const json = (o: object) => base64url(encoder.encode(JSON.stringify(o)));
    const head = json({ alg: "HS256", typ: "JWT" });
    const now = Math.floor(Date.now() / 1000);
    const body = json({
        sub,
        role: "authenticated",
        aud: "authenticated",
        iss: "supabase-demo",
        iat: now,
        exp: now + 3600,
    });
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(JWT_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(`${head}.${body}`),
    );
    return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

const admin = createClient<Database>(URL, SERVICE_KEY, {
    auth: { persistSession: false },
});
const user = createClient<Database>(URL, ANON_KEY, {
    auth: { persistSession: false },
    global: {
        headers: reachable
            ? {
                  Authorization: `Bearer ${await userToken(
                      "00000000-0000-0000-0000-000000094001",
                  )}`,
              }
            : {},
    },
});

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

const SERIES = { alpha: -940001, beta: -940002 };
const TESTS = [
    { id: -940011, series_id: SERIES.alpha, division: "State", format: "Sprint", year: 2020 },
    { id: -940012, series_id: SERIES.alpha, division: "State", format: "Team", year: 2021 },
    { id: -940013, series_id: SERIES.alpha, division: "National", format: "Sprint", year: 2022 },
    { id: -940014, series_id: SERIES.beta, division: "State", format: "Team", year: 2020 },
    { id: -940015, series_id: SERIES.beta, division: null, format: null, year: 2021 },
];
const TOPICS = ["geometry", "algebra"];

/** One gradeable problem per (test, topic), plus a cross-series duplicate. */
function fixtureProblems() {
    const rows: Record<string, unknown>[] = [];
    let id = -940100;
    for (const t of TESTS) {
        for (const [i, topic] of TOPICS.entries()) {
            rows.push({
                id: id--,
                test_id: t.id,
                n: i,
                topic,
                statement: "s",
                choices: ["a", "b", "c", "d", "e"],
                answer_index: 0,
                answer_status: "known",
                sync_key: `test:goal-contract:${t.id}:${i}`,
            });
        }
    }
    // The duplicate: canonical under alpha/National, alias under beta/State.
    rows.push({
        id: -940301,
        test_id: -940013,
        n: 9,
        topic: "geometry",
        statement: "dup",
        choices: ["a", "b"],
        answer_index: 0,
        answer_status: "known",
        sync_key: "test:goal-contract:dup:canonical",
    });
    rows.push({
        id: -940302,
        test_id: -940014,
        n: 9,
        topic: "geometry",
        statement: "dup",
        choices: ["a", "b"],
        answer_index: 0,
        answer_status: "known",
        canonical_id: -940301,
        sync_key: "test:goal-contract:dup:alias",
    });
    return rows;
}

const SCOPES: { name: string; scope: GoalScope }[] = [
    {
        name: "a single unnarrowed series",
        scope: { topic: [], seriesIds: [`${SERIES.alpha}`], seriesScopes: {} },
    },
    {
        name: "two unnarrowed series",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {},
        },
    },
    {
        name: "one series narrowed by division",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["State"], formats: [] },
            },
        },
    },
    {
        name: "one series narrowed by division and format",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["State"], formats: ["Sprint"] },
            },
        },
    },
    {
        name: "a multi-value narrowing",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: {
                    divisions: ["State", "National"],
                    formats: ["Sprint"],
                },
            },
        },
    },
    {
        // The case the OR-of-ANDs exists for: a division named in one series
        // must not filter another series that happens to use the same word.
        name: "one series narrowed, another not",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["National"], formats: [] },
            },
        },
    },
    {
        name: "both series narrowed differently",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["State"], formats: ["Team"] },
                [SERIES.beta]: { divisions: [], formats: ["Team"] },
            },
        },
    },
    {
        name: "a narrowing that matches nothing",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["Nowhere"], formats: [] },
            },
        },
    },
    {
        name: "topic narrowing across two series",
        scope: {
            topic: ["geometry"],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {},
        },
    },
    {
        name: "topic plus a per-series narrowing",
        scope: {
            topic: ["algebra"],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: { divisions: ["State"], formats: [] },
            },
        },
    },
    {
        name: "shared problem-number range across series",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {
                [SERIES.alpha]: {
                    divisions: [],
                    formats: [],
                    problemNumbers: [2, 2],
                },
                [SERIES.beta]: {
                    divisions: [],
                    formats: [],
                    problemNumbers: [2, 2],
                },
            },
        },
    },
    {
        name: "split problem-number ranges",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {
                [SERIES.alpha]: {
                    divisions: [],
                    formats: [],
                    problemNumbers: [1, 1],
                },
                [SERIES.beta]: {
                    divisions: [],
                    formats: [],
                    problemNumbers: [2, 2],
                },
            },
        },
    },
    {
        name: "a year range on one series",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`],
            seriesScopes: {
                [SERIES.alpha]: {
                    divisions: [],
                    formats: [],
                    yearRange: [2020, 2020],
                },
            },
        },
    },
    {
        name: "split years across series",
        scope: {
            topic: [],
            seriesIds: [`${SERIES.alpha}`, `${SERIES.beta}`],
            seriesScopes: {
                [SERIES.alpha]: {
                    divisions: [],
                    formats: [],
                    yearRange: [2020, 2020],
                },
            },
        },
    },
];

/** The trainer's own filter, applied the way `applyAttributeFilters` applies it. */
async function trainerCanonicals(scope: GoalScope): Promise<number[]> {
    const settings = {
        seriesIds: scope.seriesIds,
        seriesScopes: scope.seriesScopes,
        topic: scope.topic,
    } as unknown as PracticeSettings;

    const select =
        `id, canonical_id, tests!inner(series_id, division, format)${seriesScopeSelectAliases(settings)}`;
    // Select is built at runtime (empty-embed aliases for problem numbers), so
    // the client's string-literal parser cannot type it.
    let query: any = admin
        .from("problems")
        .select(select)
        .gte("id", -949999)
        .lte("id", -940000);

    if (scope.topic.length > 0) query = query.in("topic", scope.topic);
    query = applySeriesScopeFilter(query, settings);

    const { data, error } = await query;
    if (error) throw error;
    // Collapse placements onto canonicals — the trainer's own alias exclusion is
    // deliberately NOT applied: it is right for discovery draws and wrong here
    // (`docs/goals.md` §5). What is under test is the scope filter itself.
    return unique(
        (data ?? []).map(
            (r: { canonical_id: number | null; id: number }) =>
                r.canonical_id ?? r.id,
        ),
    );
}

async function sqlCanonicals(scope: GoalScope): Promise<number[]> {
    const { data, error } = await user.rpc("goal_scope_canonicals", {
        p_scope: scope as unknown as Database["public"]["Tables"]["goals"]["Row"]["scope"],
    });
    if (error) throw error;
    return unique(
        (data ?? [])
            .map((r) => r.canonical_id)
            .filter((id) => id <= -940000 && id >= -949999),
    );
}

function unique(ids: number[]): number[] {
    return [...new Set(ids)].sort((a, b) => a - b);
}

// Setup and teardown are ordinary tests because `beforeAll`/`afterAll` are not
// in the available type surface. Bun runs a file's tests in declaration order,
// so seeding first and cleaning up last is equivalent — and a failing fixture
// now names itself instead of surfacing as ten unrelated failures.
if (!reachable) {
    describe("scope contract: SQL resolver ≡ trainer filter", () => {
        test("skipped — no local Supabase stack on 127.0.0.1:54321", () => {
            expect(reachable).toBe(false);
        });
    });
} else {
    describe("scope contract: SQL resolver ≡ trainer filter", () => {
        test("fixture loads", async () => {
            await cleanup();
            const series = await admin.from("series").insert([
                { id: SERIES.alpha, name: "test:goal-contract:alpha" },
                { id: SERIES.beta, name: "test:goal-contract:beta" },
            ]);
            expect(series.error).toBeNull();
            const tests = await admin.from("tests").insert(
                TESTS.map((t) => ({
                    ...t,
                    name: `test:goal-contract:${t.id}`,
                    sync_key: `test:goal-contract:${t.id}`,
                })),
            );
            expect(tests.error).toBeNull();
            const problems = await admin
                .from("problems")
                .insert(fixtureProblems() as never);
            expect(problems.error).toBeNull();
        });

        for (const { name, scope } of SCOPES) {
            test(name, async () => {
                const [sql, trainer] = await Promise.all([
                    sqlCanonicals(scope),
                    trainerCanonicals(scope),
                ]);
                expect(sql).toEqual(trainer);
            });
        }

        test("the fixture is capable of telling the two apart", async () => {
            // A guard against the whole suite passing because every scope
            // resolves to nothing: at least one case must select a non-empty
            // set, and the narrowings must not all agree by selecting
            // everything.
            const all = await sqlCanonicals(SCOPES[1].scope);
            const narrowed = await sqlCanonicals(SCOPES[3].scope);
            expect(all.length).toBeGreaterThan(0);
            expect(narrowed.length).toBeGreaterThan(0);
            expect(narrowed.length).toBeLessThan(all.length);
        });

        test("fixture is removed", async () => {
            await cleanup();
            const { data } = await admin
                .from("problems")
                .select("id")
                .gte("id", -949999)
                .lte("id", -940000);
            expect(data ?? []).toEqual([]);
        });
    });
}

async function cleanup() {
    await admin.from("problems").delete().gte("id", -949999).lte("id", -940000);
    await admin.from("tests").delete().gte("id", -949999).lte("id", -940000);
    await admin.from("series").delete().gte("id", -949999).lte("id", -940000);
}
