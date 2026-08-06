import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

export async function requireAIUser(locals: App.Locals) {
    const { user } = await locals.safeGetSession();
    if (!user) error(401, { message: "Authentication required" });
    return user;
}

export function assertSameOrigin(request: Request, url: URL): void {
    const origin = request.headers.get("origin");
    if (!origin || origin !== url.origin) {
        error(403, { message: "Invalid request origin" });
    }
}

interface RateEntry {
    count: number;
    resetAt: number;
}

const rateEntries = new Map<string, RateEntry>();

export function assertRateLimit(
    userId: string,
    operation: string,
    limit = 30,
    windowMs = 60_000,
): void {
    const key = `${operation}:${userId}`;
    const now = Date.now();
    const current = rateEntries.get(key);
    if (!current || current.resetAt <= now) {
        rateEntries.set(key, { count: 1, resetAt: now + windowMs });
        return;
    }
    current.count += 1;
    if (current.count > limit) error(429, { message: "Too many AI requests" });
}

export function stableError(
    code: string,
    message: string,
    status = 400,
    /** Extra top-level fields. Used by the work-anchor conflict to name the winning thread. */
    extra?: Record<string, unknown>,
): Response {
    return json({ ...extra, error: { code, message } }, { status });
}

/**
 * A work-anchor collision (§2): another surface already owns this problem in this
 * sitting. The winner's id is named so the caller can attach to it — the "continue"
 * branch of the resume prompt, reached from a lost race. Structurally typed rather than
 * importing the error, to keep the service-role client out of this module.
 */
export function anchorConflictResponse(conflict: { conversationId: string }): Response {
    return stableError(
        "work_anchor_conflict",
        "Another Coach thread already owns this problem in this session",
        409,
        { conversationId: conflict.conversationId },
    );
}

export function requestIp(event: Pick<RequestEvent, "getClientAddress">): string {
    try {
        return event.getClientAddress();
    } catch {
        return "unknown";
    }
}
