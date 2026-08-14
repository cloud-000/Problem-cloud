import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { parseSyncRequest, parseSyncResponse } from "$lib/offline/contracts";
import { SYNC_MAX_ANSWER_BYTES, SYNC_MAX_REQUEST_BYTES } from "$lib/offline/limits";
import { OfflineParseError } from "$lib/offline/parse";
import {
    assertBodyLimit,
    assertOfflineOrigin,
    offlineErrorResponse,
    parseErrorOperationId,
    requireOfflineUser,
} from "$lib/server/offline/http";

export const POST: RequestHandler = async ({ locals, request, url }) => {
    await requireOfflineUser(locals);
    assertOfflineOrigin(request, url);
    assertBodyLimit(request);
    let body;
    try {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > SYNC_MAX_REQUEST_BYTES) {
            return offlineErrorResponse(new Error("OFFLINE_BATCH_TOO_LARGE"));
        }
        body = parseSyncRequest(JSON.parse(text));
        for (const operation of body.operations) {
            if (
                operation.type === "submission" &&
                new TextEncoder().encode(operation.payload.answer ?? "").byteLength >
                    SYNC_MAX_ANSWER_BYTES
            ) {
                return offlineErrorResponse(
                    new Error(`OFFLINE_OPERATION_INVALID:${operation.id}:answer too large`),
                    operation.id,
                );
            }
        }
    } catch (cause) {
        return offlineErrorResponse(
            cause instanceof OfflineParseError
                ? new Error(`OFFLINE_OPERATION_INVALID:${cause.message}`)
                : cause,
        );
    }

    try {
        const { data, error } = await locals.supabase.rpc("offline_sync_v1", {
            p_device_id: body.deviceId,
            p_checkout_id: body.checkoutId,
            p_package_id: body.packageId,
            p_package_revision: body.packageRevision,
            p_operations: body.operations,
            p_client_session: body.clientSession ?? null,
        } as never);
        if (error) throw error;
        return json(parseSyncResponse(data));
    } catch (cause) {
        return offlineErrorResponse(cause, parseErrorOperationId(cause));
    }
};
