import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { FactRef, FactWarning, ResolvedFact } from "./facts";
import type { NormalizedAIMessage } from "../types";
import type { Policy } from "./policy";
import { renderFacts } from "./render";

type Supabase = SupabaseClient<Database>;
export const HISTORY_CONTEXT_MAX_CHARS = 24_000;

const missing = (what: string): FactWarning => ({
    code: "missing",
    message: `${what} is no longer available; treat references to it as degraded context.`,
});

function answerFor(row: { choices: string[] | null; answer_index: number | null }): string | null {
    const index = row.answer_index;
    if (!row.choices || index == null || index < 0 || index >= row.choices.length) return null;
    return `${String.fromCharCode(65 + index)}. ${row.choices[index]}`;
}

/** Resolves durable refs against live data. Failures degrade into explicit facts. */
export async function resolveFacts(
    supabase: Supabase,
    refs: FactRef[],
    userId?: string,
): Promise<ResolvedFact[]> {
    return Promise.all(
        refs.map(async (ref): Promise<ResolvedFact> => {
            if (ref.kind === "attempt" || ref.kind === "selection") return ref;
            if (ref.kind === "problem") {
                const { data } = await supabase
                    .from("problems")
                    .select(
                        "id, statement, choices, answer_index, answer_status, topic, problem_ratings(scope, rating), tests(name, series(name))",
                    )
                    .eq("id", ref.id)
                    .maybeSingle();
                if (!data) {
                    return {
                        kind: "problem",
                        id: ref.id,
                        statement: "Problem content unavailable.",
                        choices: null,
                        answer: null,
                        topic: "",
                        source: "",
                        rating: null,
                        warnings: [missing(`Problem ${ref.id}`)],
                    };
                }
                const row = data as unknown as {
                    id: number;
                    statement: string | null;
                    choices: string[] | null;
                    answer_index: number | null;
                    answer_status: string | null;
                    topic: string | null;
                    problem_ratings: { scope: string; rating: number }[] | null;
                    tests: { name: string; series: { name: string } | null } | null;
                };
                const warnings: FactWarning[] = [];
                if (row.answer_status === "source_missing") {
                    warnings.push({ code: "answer_missing", message: "The source has no verified answer key." });
                }
                const { data: reports } = await supabase
                    .from("user_submitted_feedback")
                    .select("answer_index, answer_text")
                    .eq("problem_id", ref.id)
                    .eq("type", "problem_report")
                    .eq("status", "pending")
                    .limit(1);
                const report = reports?.[0];
                if (report) {
                    const suggested =
                        report.answer_text?.trim() ||
                        (report.answer_index == null
                            ? null
                            : String.fromCharCode(65 + report.answer_index));
                    warnings.push({
                        code: "answer_unverified",
                        message: `This problem's answer has been reported as incorrect${suggested ? ` (suggested: ${suggested})` : ""}; treat it as unverified.`,
                    });
                }
                return {
                    kind: "problem",
                    id: row.id,
                    statement: row.statement ?? "Problem statement unavailable.",
                    choices: row.choices,
                    answer: answerFor(row),
                    topic: row.topic ?? "",
                    source: [row.tests?.series?.name, row.tests?.name].filter(Boolean).join(" · "),
                    rating:
                        row.problem_ratings?.find((rating) => rating.scope === "overall")?.rating ?? null,
                    warnings,
                };
            }
            if (ref.kind === "test") {
                const { data } = await supabase
                    .from("tests")
                    .select("id, name, series(name)")
                    .eq("id", ref.id)
                    .maybeSingle();
                const row = data as unknown as
                    | { id: number; name: string; series: { name: string } | null }
                    | null;
                return row
                    ? { kind: "test", id: row.id, name: row.name, series: row.series?.name ?? null, warnings: [] }
                    : { kind: "test", id: ref.id, name: "Unavailable test", series: null, warnings: [missing(`Test ${ref.id}`)] };
            }
            if (ref.kind === "series") {
                const { data } = await supabase.from("series").select("id, name").eq("id", ref.id).maybeSingle();
                return data
                    ? { kind: "series", id: data.id, name: data.name, warnings: [] }
                    : { kind: "series", id: ref.id, name: "Unavailable series", warnings: [missing(`Series ${ref.id}`)] };
            }

            if (!userId) {
                return { kind: "user-profile", rating: null, activeSession: null, recentTopics: [], warnings: [missing("User profile")] };
            }
            const [{ data: rating }, { data: session }, { data: submissions }] = await Promise.all([
                supabase.from("player_ratings").select("rating").eq("user_id", userId).eq("scope", "overall").maybeSingle(),
                supabase.from("practice_sessions").select("name").eq("user_id", userId).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
                supabase.from("submissions").select("problems(topic)").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
            ]);
            const topics = (submissions ?? [])
                .map((entry) => (entry.problems as unknown as { topic: string | null } | null)?.topic)
                .filter((topic): topic is string => !!topic);
            return {
                kind: "user-profile",
                rating: rating?.rating ?? null,
                activeSession: session?.name ?? null,
                recentTopics: [...new Set(topics)].slice(0, 4),
                warnings: [],
            };
        }),
    );
}

export async function renderSnapshot(
    supabase: Supabase,
    refs: FactRef[],
    policy: Policy,
    userId?: string,
): Promise<string> {
    return renderFacts(await resolveFacts(supabase, refs, userId), policy);
}

/** Re-resolves stored refs whenever history is replayed; rendered prose is never durable. */
export async function renderHistorySnapshots(
    supabase: Supabase,
    messages: NormalizedAIMessage[],
    policy: Policy,
    userId?: string,
): Promise<NormalizedAIMessage[]> {
    const rendered = await Promise.all(
        messages.map(async (message) =>
            message.role === "user" && message.contextSnapshot?.length
                ? {
                      ...message,
                      renderedContext: await renderSnapshot(
                          supabase,
                          message.contextSnapshot,
                          policy,
                          userId,
                      ),
                  }
                : message,
        ),
    );
    // Keep the newest historical facts when the aggregate exceeds the request budget,
    // matching transcript truncation. Per-fact and per-turn limits are enforced by the
    // renderer; this is the cross-turn bound.
    let remaining = HISTORY_CONTEXT_MAX_CHARS;
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
        const context = rendered[index].renderedContext;
        if (!context) continue;
        rendered[index] = {
            ...rendered[index],
            renderedContext: context.slice(0, remaining),
        };
        remaining = Math.max(0, remaining - context.length);
    }
    return rendered;
}
