import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
    assertOfflineOrigin,
    offlineErrorResponse,
    requireOfflineUser,
} from "$lib/server/offline/http";

const ACTIONS = {
    ready: "offline_mark_checkout_ready",
    close: "offline_close_checkout",
    abandon: "offline_abandon_checkout",
} as const;

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
    await requireOfflineUser(locals);
    assertOfflineOrigin(request, url);
    const rpc = ACTIONS[params.action as keyof typeof ACTIONS];
    if (!rpc) return offlineErrorResponse(new Error("OFFLINE_OPERATION_INVALID:action"));
    try {
        const { error } = await locals.supabase.rpc(rpc, {
            p_checkout_id: params.checkoutId,
        });
        if (error) throw error;
        return json({ version: 1, status: params.action });
    } catch (cause) {
        return offlineErrorResponse(cause);
    }
};
