import type { AICoachConnectionState } from "../types";

/**
 * Probes an OpenAI-compatible `GET /models` endpoint. Server-only: this speaks the
 * vendor wire format, unlike `$lib/ai/schemas`, which validates our own normalized
 * contract. Discovery owns which models exist; the preset tables only decorate them.
 */

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const MODEL_PROBE_TIMEOUT_MS = 5_000;
/**
 * The only bound on how many models a connection can contribute. Nothing downstream
 * truncates — the picker shows everything the endpoint serves and lets the user search
 * it — so this exists purely to stop a hostile or broken endpoint from returning an
 * unbounded list. It sits far above what any real provider serves (OpenRouter, the
 * largest, is ~350).
 */
const MAX_PROBE_IDS = 2_000;

/**
 * Families that cannot hold a conversation. `GET /models` mixes them in with chat models
 * and gives no capability flags to tell them apart, so the id is the only signal there is.
 *
 * This is a denylist on purpose. An allowlist of curated ids hides every model a provider
 * ships after we last edited the table — the picker is default-allow so a brand new model
 * shows up the day it exists. Keep these patterns narrow and anchored to unambiguous
 * families: a false positive here silently hides a chat model, which is the exact failure
 * the allowlist was removed for.
 */
const NON_CHAT_PATTERNS = [
    /(^|[-_])embed/,
    /whisper/,
    /^tts[-_]/,
    /[-_]tts$/,
    /^dall[-_]e/,
    /moderation/,
    /rerank/,
    /stable[-_]diffusion/,
    /^flux[-_]/,
];

/**
 * Ids arrive either bare ("gpt-4o") or vendor-prefixed ("openai/gpt-4o"), so match on the
 * last path segment — "openai/whisper-1" is a speech model, but a vendor named "embed"
 * must not disqualify its chat models.
 */
export function isChatModelId(id: string): boolean {
    const name = (id.split("/").pop() ?? id).toLowerCase();
    return !NON_CHAT_PATTERNS.some((pattern) => pattern.test(name));
}

export interface ModelProbeResult {
    state: AICoachConnectionState;
    /** Ids reported by the endpoint. Empty when the probe could not enumerate them. */
    modelIds: string[];
    /** Set when `state` is not "connected". Safe to show a user — never provider text. */
    blockingMessage?: string;
}

const BLOCKING_MESSAGE: Record<Exclude<AICoachConnectionState, "connected">, string> = {
    disconnected: "This connection is not configured.",
    needs_reauth: "This API key was rejected. Check the key and try again.",
    quota_exhausted: "This provider reported the account is out of quota or rate limited.",
    error: "Could not reach this provider's endpoint.",
};

/**
 * Requests run from the user's browser, so a provider that does not send permissive CORS
 * headers fails as an opaque network error indistinguishable from being offline. Naming
 * the likely cause is the difference between an actionable message and a dead end.
 */
const UNREACHABLE_MESSAGE =
    "Could not reach this provider from your browser. It may be offline, or it may not allow direct browser requests (CORS).";

function stateFor(status: number): AICoachConnectionState {
    if (status === 401 || status === 403) return "needs_reauth";
    if (status === 429) return "quota_exhausted";
    return "error";
}

/** Extracts ids from `{data: [{id}]}`, tolerating endpoints that return a bare array. */
function readModelIds(payload: unknown): string[] {
    const rows = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { data?: unknown })?.data)
          ? ((payload as { data: unknown[] }).data)
          : [];
    const ids: string[] = [];
    for (const row of rows) {
        const id = (row as { id?: unknown })?.id;
        if (typeof id === "string" && id.length > 0 && id.length <= 160) ids.push(id);
        if (ids.length >= MAX_PROBE_IDS) break;
    }
    return ids;
}

/**
 * Never throws and never surfaces provider error text: a probe result is rendered to
 * the user, and some providers echo the request (or a key prefix) back in error bodies.
 */
export async function probeModels(
    baseURL: string,
    apiKey: string,
    fetchImpl: FetchFunction = fetch,
): Promise<ModelProbeResult> {
    let response: Response;
    try {
        response = await fetchImpl(`${baseURL}/models`, {
            method: "GET",
            headers: {
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
                accept: "application/json",
            },
            signal: AbortSignal.timeout(MODEL_PROBE_TIMEOUT_MS),
        });
    } catch {
        return { state: "error", modelIds: [], blockingMessage: UNREACHABLE_MESSAGE };
    }

    // A 404 only means this endpoint doesn't implement /models — a legitimate shape for
    // some local servers. Treat the connection as usable and fall back to curated ids.
    if (response.status === 404) return { state: "connected", modelIds: [] };

    if (!response.ok) {
        const state = stateFor(response.status);
        return {
            state,
            modelIds: [],
            blockingMessage: BLOCKING_MESSAGE[state as Exclude<AICoachConnectionState, "connected">],
        };
    }

    try {
        return { state: "connected", modelIds: readModelIds(await response.json()) };
    } catch {
        // Reachable and authorized, but unparseable — usable, just not enumerable.
        return { state: "connected", modelIds: [] };
    }
}
