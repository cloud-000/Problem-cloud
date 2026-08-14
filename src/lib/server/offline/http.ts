import { error, json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import type { OfflineSyncErrorCode, OfflineSyncErrorV1 } from "$lib/offline/types";

export async function requireOfflineUser(locals: App.Locals) {
    const { user } = await locals.safeGetSession();
    if (!user) error(401, { message: "Authentication required" });
    return user;
}

export function assertOfflineOrigin(request: Request, url: URL): void {
    const origin = request.headers.get("origin");
    if (!origin || origin !== url.origin) error(403, { message: "Invalid request origin" });
}

export function assertBodyLimit(request: Request, maxBytes = 1024 * 1024): void {
    const raw = request.headers.get("content-length");
    if (raw !== null && Number(raw) > maxBytes) error(413, { message: "Request body is too large" });
}

function mappedDatabaseError(message: string): {
    code: OfflineSyncErrorCode;
    retryable: boolean;
    status: number;
} {
    if (message.includes("OFFLINE_AUTH_REQUIRED")) {
        return { code: "auth_required", retryable: false, status: 401 };
    }
    if (message.includes("OFFLINE_OWNER_MISMATCH")) {
        return { code: "owner_mismatch", retryable: false, status: 403 };
    }
    if (message.includes("OFFLINE_PACKAGE_REVISION_INVALID")) {
        return { code: "package_revision_invalid", retryable: false, status: 409 };
    }
    if (message.includes("OFFLINE_CHECKOUT_INVALID")) {
        return { code: "checkout_invalid", retryable: false, status: 409 };
    }
    if (message.includes("OFFLINE_BATCH_TOO_LARGE")) {
        return { code: "batch_too_large", retryable: false, status: 413 };
    }
    if (message.includes("OFFLINE_OPERATION_INVALID")) {
        return { code: "operation_invalid", retryable: false, status: 400 };
    }
    if (message.includes("OFFLINE_CONFLICT")) {
        return { code: "conflict", retryable: false, status: 409 };
    }
    return { code: "temporary", retryable: true, status: 503 };
}

/**
 * Supabase/PostgREST errors are plain objects rather than `Error` instances.
 * Keep extraction deliberately narrow: the database marker is needed for the
 * stable public mapping below, while SQL details must never be reflected.
 */
export function offlineCauseMessage(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    if (
        typeof cause === "object" &&
        cause !== null &&
        "message" in cause &&
        typeof cause.message === "string"
    ) {
        return cause.message;
    }
    return String(cause);
}

/** Stable v1 error envelope; database details are never reflected to clients. */
export function offlineErrorResponse(cause: unknown, operationId?: string): Response {
    const raw = offlineCauseMessage(cause);
    const mapped = mappedDatabaseError(raw);
    const body: OfflineSyncErrorV1 = {
        version: 1,
        status: "error",
        code: mapped.code,
        retryable: mapped.retryable,
        ...(operationId ? { operationId } : {}),
        message:
            mapped.code === "temporary"
                ? "Offline data is temporarily unavailable"
                : "The offline request could not be applied",
    };
    return json(body, { status: mapped.status });
}

export function parseErrorOperationId(cause: unknown): string | undefined {
    const message = offlineCauseMessage(cause);
    return message.match(
        /OFFLINE_(?:OPERATION_INVALID|CONFLICT):([0-9a-f-]{36}):/i,
    )?.[1];
}

export type OfflineRequestEvent = Pick<RequestEvent, "locals" | "request" | "url">;
