import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { parsePackagePage } from "$lib/offline/contracts";
import type { OfflinePackageRecordsV1 } from "$lib/offline/types";
import { offlineErrorResponse, requireOfflineUser } from "$lib/server/offline/http";

function cursorIndex(raw: string | null): number | null {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : null;
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
    await requireOfflineUser(locals);
    const index = cursorIndex(url.searchParams.get("cursor"));
    if (index === null) return offlineErrorResponse(new Error("OFFLINE_OPERATION_INVALID:cursor"));
    try {
        const { data: checkout, error: checkoutError } = await locals.supabase
            .from("offline_checkouts")
            .select("package_id, package_revision, problem_count, page_size, status")
            .eq("id", params.checkoutId)
            .single();
        if (checkoutError || !checkout || checkout.status !== "issued") {
            throw new Error("OFFLINE_PACKAGE_REVISION_INVALID");
        }
        const { data: page, error: pageError } = await locals.supabase
            .from("offline_package_pages")
            .select("page_index, records, checksum")
            .eq("checkout_id", params.checkoutId)
            .eq("page_index", index)
            .single();
        if (pageError || !page?.checksum) throw new Error("OFFLINE_PACKAGE_REVISION_INVALID");
        const records = page.records as OfflinePackageRecordsV1;
        const lastPage = Math.ceil(checkout.problem_count / checkout.page_size) - 1;
        return json(
            parsePackagePage({
                version: 1,
                packageId: checkout.package_id,
                checkoutId: params.checkoutId,
                packageRevision: checkout.package_revision,
                pageIndex: page.page_index,
                nextCursor: page.page_index < lastPage ? String(page.page_index + 1) : null,
                counts: {
                    memberships: records.memberships.length,
                    problems: records.problems.length,
                    placements: records.placements.length,
                    assets: records.assets.length,
                    personalStates: records.personalStates.length,
                    ratings: records.ratings.length,
                },
                checksum: page.checksum,
                records,
            }),
        );
    } catch (cause) {
        return offlineErrorResponse(cause);
    }
};
