/**
 * Real catalog problems for the public splash trainer. The chrome stays a
 * self-contained sit (no account, no submission) so a visitor can try one;
 * the rows themselves come from the world-readable `problems` table, same
 * as the corpus count on this page.
 *
 * Prefer recent AMC 10 — the splash already seeds that series in the filter
 * mock — and keep only short, diagram-free MCQs so they fit the hero box
 * without disclosing a free-response key (see `isMultipleChoice`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "#lib/types/database.types.js";
import { hasComparableAnswer } from "#lib/problem-response.js";
import { isMultipleChoice } from "#lib/utils.js";

export const WELCOME_PREFERRED_SERIES = "AMC 10";
export const WELCOME_TRAINER_LIMIT = 5;
export const WELCOME_STATEMENT_MAX = 200;
export const WELCOME_MIN_YEAR = 2018;
export const WELCOME_MAX_N = 4;

export type WelcomeProblem = {
    id: number;
    n: number;
    statement: string;
    choices: string[] | null;
    answer_index: number | null;
    answer_status: string | null;
    response_kind: string | null;
    tests: { name: string | null; year: number | null } | null;
};

const WELCOME_PROBLEM_SELECT =
    "id, n, statement, choices, answer_index, answer_status, response_kind, tests!inner(name, year, series_id)";
const WELCOME_PROBLEM_SERIES_NAME_SELECT =
    "id, n, statement, choices, answer_index, answer_status, response_kind, tests!inner(name, year, series_id, series!inner(name))";

export function isWelcomeTrainerProblem(problem: WelcomeProblem): boolean {
    const statement = problem.statement.trim();
    if (!statement) return false;
    if (statement.length > WELCOME_STATEMENT_MAX) return false;
    if (/\[asy\]/i.test(statement) || /\[img\b/i.test(statement)) return false;
    if (!isMultipleChoice(problem.choices)) return false;
    return hasComparableAnswer(problem);
}

/** Newest papers first, then the opening problems of each paper. */
export function pickWelcomeProblems(rows: WelcomeProblem[]): WelcomeProblem[] {
    const sorted = rows.filter(isWelcomeTrainerProblem).sort((a, b) => {
        const year = (b.tests?.year ?? 0) - (a.tests?.year ?? 0);
        if (year !== 0) return year;
        if (a.n !== b.n) return a.n - b.n;
        return a.id - b.id;
    });
    const seen = new Set<string>();
    const picked: WelcomeProblem[] = [];
    for (const row of sorted) {
        const key = row.tests?.name ?? `id:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(row);
        if (picked.length >= WELCOME_TRAINER_LIMIT) break;
    }
    return picked;
}

export function welcomeProblemSource(problem: WelcomeProblem): string {
    return problem.tests?.name
        ? `${problem.tests.name} · Problem ${problem.n + 1}`
        : `Problem ${problem.n + 1}`;
}

export async function loadWelcomeProblems(
    supabase: SupabaseClient<Database>,
    seriesFilter: number | string | null,
): Promise<WelcomeProblem[]> {
    const select =
        typeof seriesFilter === "string"
            ? WELCOME_PROBLEM_SERIES_NAME_SELECT
            : WELCOME_PROBLEM_SELECT;
    let query = supabase
        .from("problems")
        .select(select)
        .eq("answer_status", "known")
        .is("canonical_id", null)
        .lte("n", WELCOME_MAX_N)
        .eq("response_kind", "mcq")
        .not("statement", "is", null)
        .gte("tests.year", WELCOME_MIN_YEAR);

    if (typeof seriesFilter === "number") {
        query = query.eq("tests.series_id", seriesFilter);
    } else if (typeof seriesFilter === "string") {
        query = query.eq("tests.series.name", seriesFilter);
    }

    const { data, error } = await query.order("n").limit(80);
    if (error || !data) return [];
    return pickWelcomeProblems(data.map(parseWelcomeProblem).filter((row) => row != null));
}

function parseWelcomeProblem(row: unknown): WelcomeProblem | null {
    if (row == null || typeof row !== "object") return null;
    const value = row as Record<string, unknown>;
    if (typeof value.id !== "number" || typeof value.n !== "number") return null;
    if (typeof value.statement !== "string") return null;
    const choices = parseChoices(value.choices);
    return {
        id: value.id,
        n: value.n,
        statement: value.statement,
        choices,
        answer_index: typeof value.answer_index === "number" ? value.answer_index : null,
        answer_status: typeof value.answer_status === "string" ? value.answer_status : null,
        response_kind: typeof value.response_kind === "string" ? value.response_kind : null,
        tests: parseTests(value.tests),
    };
}

function parseChoices(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    if (!value.every((item) => typeof item === "string")) return null;
    return value;
}

function parseTests(
    value: unknown,
): WelcomeProblem["tests"] {
    if (Array.isArray(value)) return parseTests(value[0]);
    if (value == null || typeof value !== "object") return null;
    const tests = value as Record<string, unknown>;
    return {
        name: typeof tests.name === "string" ? tests.name : null,
        year: typeof tests.year === "number" ? tests.year : null,
    };
}
