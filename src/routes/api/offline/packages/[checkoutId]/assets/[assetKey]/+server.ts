import type { RequestHandler } from "./$types";
import { assetKey } from "$lib/offline/checksum";
import type { OfflineAssetV1, OfflinePackageRecordsV1 } from "$lib/offline/types";
import {
    fetchOfflineAssetSource,
    offlineAssetSource,
} from "$lib/server/offline/assets";
import {
    offlineErrorResponse,
    requireOfflineUser,
} from "$lib/server/offline/http";

export const GET: RequestHandler = async ({ locals, params }) => {
    await requireOfflineUser(locals);
    try {
        // RLS proves this checkout belongs to the authenticated user.
        const { data: checkout, error: checkoutError } = await locals.supabase
            .from("offline_checkouts")
            .select("status")
            .eq("id", params.checkoutId)
            .single();
        if (checkoutError || checkout?.status !== "issued") {
            throw new Error("OFFLINE_PACKAGE_REVISION_INVALID");
        }

        const { data: pages, error: pagesError } = await locals.supabase
            .from("offline_package_pages")
            .select("records")
            .eq("checkout_id", params.checkoutId);
        if (pagesError) throw pagesError;

        let matched: OfflineAssetV1 | null = null;
        for (const page of pages ?? []) {
            const records = page.records as unknown as OfflinePackageRecordsV1;
            matched = records.assets.find((asset) => asset.key === params.assetKey) ?? null;
            if (matched) break;
        }
        if (!matched || (await assetKey(matched.url)) !== params.assetKey) {
            throw new Error("OFFLINE_OPERATION_INVALID:unknown checkout asset");
        }
        const source = offlineAssetSource(matched.url);
        if (!source) throw new Error("OFFLINE_OPERATION_INVALID:asset origin");
        const fetched = await fetchOfflineAssetSource(source);
        return new Response(fetched.body, {
            headers: {
                "content-type": fetched.contentType,
                "cache-control": "private, no-store",
                "x-content-type-options": "nosniff",
            },
        });
    } catch (cause) {
        return offlineErrorResponse(cause);
    }
};
