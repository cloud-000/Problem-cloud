import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ProblemRow } from "$lib/library";

type Supabase = SupabaseClient<Database>;

export type PracticeSettings = {
    topic: string[];
    difficulty: [number, number];
    verifiedOnly: boolean;
    computational: boolean | null;
};

export type PracticeAttempt = {
    problemId: number;
    selectedChoice: number | null;
    correct: boolean | null;
    elapsedMs: number;
    skipped: boolean;
    flagged: boolean;
};

const PROBLEM_SELECT = "*, tests(name, series_id, series(name))";
const MAX_RANDOM_ATTEMPTS = 6;
const FALLBACK_PAGE_SIZE = 25;

function applySettings(query: any, settings: PracticeSettings) {
    let next = query
        .not("statement", "is", null)
        .not("choices", "is", null)
        .gte("answer_index", 0);

    if (settings.topic.length > 0) next = next.in("topic", settings.topic);
    if (settings.difficulty) {
        next = next
            .gte("difficulty", settings.difficulty[0])
            .lte("difficulty", settings.difficulty[1]);
    }
    if (settings.verifiedOnly) next = next.eq("verified", true);
    if (settings.computational != null) {
        next = next.eq("is_computational", settings.computational);
    }

    return next;
}

function isEligibleProblem(problem: ProblemRow | null): problem is ProblemRow {
    if (!problem?.statement?.trim()) return false;
    if (!problem.choices?.length) return false;
    if (problem.answer_index == null) return false;
    return problem.answer_index >= 0 && problem.answer_index < problem.choices.length;
}

async function fetchRandomCandidate(
    supabase: Supabase,
    settings: PracticeSettings,
    count: number,
): Promise<ProblemRow | null> {
    const offset = Math.floor(Math.random() * count);
    const { data, error } = await applySettings(
        supabase.from("problems").select(PROBLEM_SELECT),
        settings,
    )
        .order("id")
        .range(offset, offset)
        .maybeSingle();

    if (error) throw error;
    return (data as unknown as ProblemRow | null) ?? null;
}

export async function generatePracticeProblem(
    supabase: Supabase,
    settings: PracticeSettings,
): Promise<ProblemRow | null> {
    const { count, error } = await applySettings(
        supabase.from("problems").select("id", { count: "exact", head: true }),
        settings,
    );

    if (error) throw error;
    if (!count) return null;

    for (let i = 0; i < MAX_RANDOM_ATTEMPTS; i += 1) {
        const candidate = await fetchRandomCandidate(supabase, settings, count);
        if (isEligibleProblem(candidate)) return candidate;
    }

    const { data, error: fallbackError } = await applySettings(
        supabase.from("problems").select(PROBLEM_SELECT),
        settings,
    )
        .order("id")
        .limit(FALLBACK_PAGE_SIZE);

    if (fallbackError) throw fallbackError;

    const eligible = ((data ?? []) as unknown as ProblemRow[]).filter(
        isEligibleProblem,
    );
    if (eligible.length === 0) return null;

    return eligible[Math.floor(Math.random() * eligible.length)];
}
