import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ContextSnapshot, FactRef, FactWarning, ResolvedFact } from "./facts";
import type { NormalizedAIMessage } from "../types";
import type { Policy } from "./policy";
import { boundCoachHistory } from "../conversations";
import {
    CONTEXT_SECTION_SEPARATOR,
    fitContextSections,
    MAX_FACT_CHARS,
    minimumContextChars,
    renderFactSections,
    renderFacts,
} from "./render";

type Supabase = SupabaseClient<Database>;
export const HISTORY_CONTEXT_MAX_CHARS = 12_000;
const REQUIRED_GROUP_MIN_CHARS = 96;
const NO_ACTIVE_SCOPE = "The previously attached problem context is no longer active.";

const missing = (what: string): FactWarning => ({
    code: "missing",
    message: `${what} is no longer available; treat references to it as degraded context.`,
});

/** Resolves durable refs against live data. Failures degrade into explicit facts. */
export async function resolveFacts(
    supabase: Supabase,
    refs: FactRef[],
    _userId?: string,
): Promise<ResolvedFact[]> {
    return Promise.all(
        refs.map(async (ref): Promise<ResolvedFact> => {
            if (ref.kind === "attempt" || ref.kind === "selection") return ref;
            if (ref.kind === "problem") {
                const { data } = await supabase
                    .from("problems")
                    .select("id, statement, choices")
                    .eq("id", ref.id)
                    .maybeSingle();
                if (!data) {
                    return {
                        kind: "problem",
                        id: ref.id,
                        statement: "Problem content unavailable.",
                        choices: null,
                        warnings: [missing(`Problem ${ref.id}`)],
                    };
                }
                const row = data as unknown as {
                    id: number;
                    statement: string | null;
                    choices: string[] | null;
                };
                return {
                    kind: "problem",
                    id: row.id,
                    statement: row.statement ?? "Problem statement unavailable.",
                    choices: row.choices,
                    warnings: [],
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

            // Kept only so legacy snapshots remain parseable. User progress is tool-only
            // and the renderer intentionally emits no profile prose.
            return {
                kind: "user-profile",
                rating: null,
                activeSession: null,
                recentTopics: [],
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

function scopeRefKey(ref: FactRef): string {
    if (ref.kind === "problem" || ref.kind === "test" || ref.kind === "series") {
        return `${ref.kind}:${ref.id}`;
    }
    // Invalid scope refs are rejected at the wire boundary. Keeping this fallback
    // deterministic makes direct callers compare malformed snapshots conservatively.
    return JSON.stringify(ref);
}

/** Scope identity is provenance, never whatever prose the current renderer emits. */
function scopeKey(refs: FactRef[]): string {
    return refs.map(scopeRefKey).sort().join("|");
}

function joinedLength(sections: string[]): number {
    if (sections.length === 0) return 0;
    return (
        sections.reduce((total, section) => total + section.length, 0) +
        CONTEXT_SECTION_SEPARATOR.length * (sections.length - 1)
    );
}

interface RequiredGroup {
    sections: string[];
    /** Current attachments first, then historical attachments newest first. */
    priority: number;
}

/**
 * Gives every required attachment group visible space, then spends the remainder in
 * priority order. `fitContextSections` makes every shortened group explicit.
 */
function allocateRequiredGroups(groups: RequiredGroup[], budget: number): string[] {
    if (groups.length === 0 || budget <= 0) return groups.map(() => "");
    const fullLengths = groups.map((group) => joinedLength(group.sections));
    const minimums = groups.map((group, index) =>
        Math.min(
            fullLengths[index],
            Math.max(REQUIRED_GROUP_MIN_CHARS, minimumContextChars(group.sections)),
        ),
    );
    const budgets = [...minimums];
    let committed = budgets.reduce((sum, value) => sum + value, 0);

    // Bounded history makes this exceptional, but keep the fallback deterministic if a
    // future schema admits enough attachment groups to exceed even their visible minima.
    if (committed > budget) {
        const each = Math.floor(budget / groups.length);
        for (let index = 0; index < budgets.length; index += 1) budgets[index] = each;
        committed = each * groups.length;
    }

    let remaining = Math.max(0, budget - committed);
    const order = groups
        .map((group, index) => ({ index, priority: group.priority }))
        .sort((a, b) => b.priority - a.priority);
    for (const { index } of order) {
        if (remaining === 0) break;
        const extra = Math.min(remaining, fullLengths[index] - budgets[index]);
        budgets[index] += extra;
        remaining -= extra;
    }

    return groups.map((group, index) => fitContextSections(group.sections, budgets[index]));
}

/**
 * Compiles a bounded transcript into semantic context frames. The current scope is
 * always emitted once beside the current prompt; attachments stay on their owning turn;
 * older scope epochs receive only the budget left after those invariants are satisfied.
 */
export async function compileContextFrames(
    supabase: Supabase,
    messages: NormalizedAIMessage[],
    current: ContextSnapshot,
    userId?: string,
): Promise<{ history: NormalizedAIMessage[]; renderedContext: string }> {
    // Both direct BYOK and server-backed callers cross this same bound before any ref is
    // resolved. Applying it here also prevents future callers from paying for context
    // attached only to transcript turns that cannot reach the provider.
    const bounded = boundCoachHistory(messages);
    const renderCache = new Map<string, Promise<string[]>>();
    const renderRefs = (refs: FactRef[], snapshotPolicy: Policy): Promise<string[]> => {
        const key = JSON.stringify([snapshotPolicy, refs]);
        let pending = renderCache.get(key);
        if (!pending) {
            pending = resolveFacts(supabase, refs, userId).then((facts) =>
                renderFactSections(facts, snapshotPolicy),
            );
            renderCache.set(key, pending);
        }
        return pending;
    };
    const scopeCache = new Map<string, Promise<string[]>>();
    const renderScope = (snapshot: ContextSnapshot): Promise<string[]> => {
        const key = scopeKey(snapshot.scope);
        let pending = scopeCache.get(key);
        if (!pending) {
            // Baseline scope contains no policy-sensitive answer data. Keying only by
            // refs avoids re-querying the same problem when a test lock changes.
            pending = renderRefs(snapshot.scope, snapshot.policy);
            scopeCache.set(key, pending);
        }
        return pending;
    };
    const renderAttachments = (snapshot: ContextSnapshot) =>
        renderRefs(snapshot.attachments, snapshot.policy);

    const userTurns = bounded.flatMap((message, index) =>
        message.role === "user" && message.contextSnapshot
            ? [{ index, snapshot: message.contextSnapshot }]
            : [],
    );
    const currentKey = scopeKey(current.scope);

    // Establish scope epochs entirely from refs. Identical rendered statements can still
    // be different problems, and a content correction must not manufacture a new epoch.
    const olderScopeCandidates: { index: number; snapshot: ContextSnapshot; key: string }[] = [];
    let previousKey: string | null = null;
    for (const turn of userTurns) {
        const key = scopeKey(turn.snapshot.scope);
        const changed = previousKey === null ? key.length > 0 : key !== previousKey;
        if (changed && key !== currentKey) {
            olderScopeCandidates.push({ ...turn, key });
        }
        previousKey = key;
    }

    // Only the already-bounded turns are resolved. Attachments are mandatory context,
    // whereas the older scope candidates below are deliberately resolved lazily.
    const [resolvedCurrentScope, resolvedCurrentAttachments, historicalAttachments] =
        await Promise.all([
            currentKey ? renderScope(current) : Promise.resolve([]),
            renderAttachments(current),
            Promise.all(
                userTurns.map(async (turn) => ({
                    index: turn.index,
                    sections: await renderAttachments(turn.snapshot),
                })),
            ),
        ]);

    const currentScopeSections = currentKey
        ? resolvedCurrentScope
        : previousKey
          ? [NO_ACTIVE_SCOPE]
          : [];
    const currentScopeBudget = Math.min(
        MAX_FACT_CHARS,
        joinedLength(currentScopeSections),
    );
    const currentScopeText = fitContextSections(currentScopeSections, currentScopeBudget);

    const attachmentGroups: RequiredGroup[] = [];
    const attachmentTargets: ({ type: "current" } | { type: "history"; index: number })[] = [];
    if (resolvedCurrentAttachments.length > 0) {
        attachmentGroups.push({ sections: resolvedCurrentAttachments, priority: Number.MAX_SAFE_INTEGER });
        attachmentTargets.push({ type: "current" });
    }
    for (let index = historicalAttachments.length - 1; index >= 0; index -= 1) {
        const attachment = historicalAttachments[index];
        if (attachment.sections.length === 0) continue;
        attachmentGroups.push({ sections: attachment.sections, priority: index });
        attachmentTargets.push({ type: "history", index: attachment.index });
    }

    const currentJoinOverhead =
        currentScopeText && resolvedCurrentAttachments.length > 0
            ? CONTEXT_SECTION_SEPARATOR.length
            : 0;
    const attachmentBudget = Math.max(
        0,
        HISTORY_CONTEXT_MAX_CHARS - currentScopeText.length - currentJoinOverhead,
    );
    const attachmentTexts = allocateRequiredGroups(attachmentGroups, attachmentBudget);
    const historySections = new Map<number, string[]>();
    let currentAttachmentText = "";
    attachmentTargets.forEach((target, index) => {
        const text = attachmentTexts[index];
        if (!text) return;
        if (target.type === "current") currentAttachmentText = text;
        else historySections.set(target.index, [text]);
    });

    const currentSections = [currentScopeText, currentAttachmentText].filter(Boolean);
    let renderedContext = currentSections.join(CONTEXT_SECTION_SEPARATOR);
    let remaining = Math.max(
        0,
        HISTORY_CONTEXT_MAX_CHARS -
            renderedContext.length -
            [...historySections.values()].reduce(
                (total, sections) => total + joinedLength(sections),
                0,
            ),
    );

    // Scope epochs are the only best-effort context. Newest epochs get the remaining
    // budget first, but each stays at the historical turn where it became active.
    for (let index = olderScopeCandidates.length - 1; index >= 0; index -= 1) {
        const candidate = olderScopeCandidates[index];
        const existing = historySections.get(candidate.index) ?? [];
        const overhead = existing.length > 0 ? CONTEXT_SECTION_SEPARATOR.length : 0;
        if (remaining <= overhead) continue;
        const sections = candidate.key ? await renderScope(candidate.snapshot) : [NO_ACTIVE_SCOPE];
        const text = fitContextSections(sections, remaining - overhead);
        if (!text) continue;
        historySections.set(candidate.index, [text, ...existing]);
        remaining -= text.length + overhead;
    }

    const rendered = bounded.map((message, index) => {
        const sections = historySections.get(index) ?? [];
        return {
            ...message,
            renderedContext: sections.length
                ? sections.join(CONTEXT_SECTION_SEPARATOR)
                : undefined,
        };
    });
    return { history: rendered, renderedContext };
}
