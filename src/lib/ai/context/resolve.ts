import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ContextSnapshot, FactRef, FactWarning, ResolvedFact, ScopeRef } from "./facts";
import type { NormalizedAIMessage } from "../types";
import type { Policy } from "./policy";
import { boundCoachHistory } from "../conversations";
import {
    CONTEXT_SECTION_SEPARATOR,
    fitContextSections,
    MAX_FACT_CHARS,
    minimumContextChars,
    renderFactSections,
} from "./render";

type Supabase = SupabaseClient<Database>;
export const HISTORY_CONTEXT_MAX_CHARS = 12_000;
const REQUIRED_GROUP_MIN_CHARS = 96;
const NO_ACTIVE_SCOPE = "The previously attached problem context is no longer active.";

const missing = (what: string): FactWarning => ({
    code: "missing",
    message: `${what} is no longer available; treat references to it as degraded context.`,
});

/** A resolver outage is retryable and must never masquerade as a deleted fact. */
export class AIContextResolutionError extends Error {
    readonly code = "context_resolution_failed";

    constructor(readonly fact: string) {
        super(`Coach could not load ${fact} context. Please retry.`);
        this.name = "AIContextResolutionError";
    }
}

async function contextData<T>(
    fact: string,
    query: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
    try {
        const { data, error } = await query;
        if (error) throw new AIContextResolutionError(fact);
        return data;
    } catch (error) {
        if (error instanceof AIContextResolutionError) throw error;
        throw new AIContextResolutionError(fact);
    }
}

/** Resolves durable refs; missing rows degrade, while query failures remain retryable. */
export async function resolveFacts(
    supabase: Supabase,
    refs: FactRef[],
): Promise<ResolvedFact[]> {
    return Promise.all(
        refs.map(async (ref): Promise<ResolvedFact> => {
            if (ref.kind === "selection") return ref;
            if (ref.kind === "problem") {
                const data = await contextData(
                    "the problem",
                    supabase
                        .from("problems")
                        .select("id, statement, choices")
                        .eq("id", ref.id)
                        .maybeSingle(),
                );
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
                const data = await contextData(
                    "the test",
                    supabase
                        .from("tests")
                        .select("id, name, series(name)")
                        .eq("id", ref.id)
                        .maybeSingle(),
                );
                const row = data as unknown as
                    | { id: number; name: string; series: { name: string } | null }
                    | null;
                return row
                    ? { kind: "test", id: row.id, name: row.name, series: row.series?.name ?? null, warnings: [] }
                    : { kind: "test", id: ref.id, name: "Unavailable test", series: null, warnings: [missing(`Test ${ref.id}`)] };
            }
            if (ref.kind === "series") {
                const data = await contextData(
                    "the series",
                    supabase.from("series").select("id, name").eq("id", ref.id).maybeSingle(),
                );
                return data
                    ? { kind: "series", id: data.id, name: data.name, warnings: [] }
                    : { kind: "series", id: ref.id, name: "Unavailable series", warnings: [missing(`Series ${ref.id}`)] };
            }

            return ref;
        }),
    );
}

function scopeRefKey(ref: ScopeRef): string {
    return `${ref.kind}:${ref.id}`;
}

/** Scope identity is provenance, never whatever prose the current renderer emits. */
function scopeKey(refs: ScopeRef[]): string {
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
 * A run of adjacent turns sharing one scope, identified by the turn where it began.
 *
 * `index` is a position in the bounded history, or `null` for an epoch that begins at
 * the current prompt. Only the newest epoch can ever sit at `null`.
 */
interface ScopeEpoch {
    index: number | null;
    key: string;
    snapshot: ContextSnapshot;
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
 * Compiles a bounded transcript into semantic context frames.
 *
 * Every frame is *pinned to the turn where it became true*: a scope epoch is emitted at
 * the turn that first carried it, and attachments stay on their owning turn. Nothing is
 * re-attached to "now".
 *
 * That placement is load-bearing twice over. A frame that slides forward each turn
 * rewrites the prefix of every request, so no provider can cache it and the transcript
 * stops matching the one the model actually answered. Worse, it drops a fully-stated
 * problem immediately above the student's newest words, and a model reading that
 * frequently answers the problem instead of the question. Pinned, the freshest thing in
 * the request is what the student just said.
 *
 * Budget follows meaning, not position: the *active* scope is guaranteed wherever its
 * frame landed, attachments come next, and superseded epochs share whatever is left.
 */
export async function compileContextFrames(
    supabase: Supabase,
    messages: NormalizedAIMessage[],
    current: ContextSnapshot,
): Promise<{ history: NormalizedAIMessage[]; renderedContext: string }> {
    // Both direct BYOK and server-backed callers cross this same bound before any ref is
    // resolved. Applying it here also prevents future callers from paying for context
    // attached only to transcript turns that cannot reach the provider.
    const bounded = boundCoachHistory(messages);
    const renderCache = new Map<string, Promise<string[]>>();
    const renderRefs = (refs: FactRef[]): Promise<string[]> => {
        const key = JSON.stringify(refs);
        let pending = renderCache.get(key);
        if (!pending) {
            pending = resolveFacts(supabase, refs).then(renderFactSections);
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
            pending = renderRefs(snapshot.scope);
            scopeCache.set(key, pending);
        }
        return pending;
    };
    const renderAttachments = (snapshot: ContextSnapshot) =>
        renderRefs(snapshot.attachments);

    const userTurns = bounded.flatMap((message, index) =>
        message.role === "user" && message.contextSnapshot
            ? [{ index, snapshot: message.contextSnapshot }]
            : [],
    );
    const currentKey = scopeKey(current.scope);

    // Establish scope epochs entirely from refs, across history *and* the current turn.
    // Identical rendered statements can still be different problems, and a content
    // correction must not manufacture a new epoch. The walk order is what pins each
    // frame: an epoch belongs to the turn that opened it, and the current prompt opens
    // one only when its scope is genuinely new — a first turn, a switch to another
    // problem, or leaving the last one behind.
    const epochs: ScopeEpoch[] = [];
    let previousKey: string | null = null;
    const opensEpoch = (key: string) => (previousKey === null ? key.length > 0 : key !== previousKey);
    for (const turn of userTurns) {
        const key = scopeKey(turn.snapshot.scope);
        if (opensEpoch(key)) epochs.push({ index: turn.index, key, snapshot: turn.snapshot });
        previousKey = key;
    }
    if (opensEpoch(currentKey)) epochs.push({ index: null, key: currentKey, snapshot: current });

    // The newest epoch is the active scope by construction: every turn after it shares
    // its key. Everything before it has been superseded and is best-effort below —
    // except an earlier epoch the thread later returned to, whose refs are the same refs
    // the active frame already renders.
    const active = epochs.at(-1);
    const superseded = epochs
        .slice(0, -1)
        .flatMap((epoch) =>
            epoch.index === null || epoch.key === currentKey
                ? []
                : [{ ...epoch, index: epoch.index }],
        );

    // Only the already-bounded turns are resolved. Attachments are mandatory context,
    // whereas the superseded epochs below are deliberately resolved lazily.
    const [activeScopeSections, resolvedCurrentAttachments, historicalAttachments] =
        await Promise.all([
            // Resolved from `current` rather than the epoch's own snapshot: the two carry
            // the same refs (that is what shares the key), and this is the live scope.
            active ? (currentKey ? renderScope(current) : Promise.resolve([NO_ACTIVE_SCOPE])) : Promise.resolve([]),
            renderAttachments(current),
            Promise.all(
                userTurns.map(async (turn) => ({
                    index: turn.index,
                    sections: await renderAttachments(turn.snapshot),
                })),
            ),
        ]);

    const activeScopeBudget = Math.min(MAX_FACT_CHARS, joinedLength(activeScopeSections));
    const activeScopeText = fitContextSections(activeScopeSections, activeScopeBudget);

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

    // The scope frame shares a turn with whatever attachments that same turn owns, so
    // the separator is charged wherever the frame landed.
    const scopeTurnAttachments = !active
        ? []
        : active.index === null
          ? resolvedCurrentAttachments
          : (historicalAttachments.find((entry) => entry.index === active.index)?.sections ?? []);
    const scopeJoinOverhead =
        activeScopeText && scopeTurnAttachments.length > 0 ? CONTEXT_SECTION_SEPARATOR.length : 0;
    const attachmentBudget = Math.max(
        0,
        HISTORY_CONTEXT_MAX_CHARS - activeScopeText.length - scopeJoinOverhead,
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

    // Pin the active scope to the turn that opened it — the current prompt only when
    // that is genuinely where it began.
    let currentScopeText = "";
    if (active && activeScopeText) {
        if (active.index === null) currentScopeText = activeScopeText;
        else {
            historySections.set(active.index, [
                activeScopeText,
                ...(historySections.get(active.index) ?? []),
            ]);
        }
    }

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

    // Superseded epochs are the only best-effort context. Newest gets the remaining
    // budget first, and each stays at the historical turn where it became active.
    for (let index = superseded.length - 1; index >= 0; index -= 1) {
        const candidate = superseded[index];
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
