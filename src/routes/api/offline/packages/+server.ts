import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { problemAssets } from "$lib/offline/assets";
import { canonicalByteLength, pageChecksum } from "$lib/offline/checksum";
import {
    normalizeScope,
    parsePackageCreateRequest,
    parsePackageCreated,
    parseRecords,
} from "$lib/offline/contracts";
import { PAGE_MAX_DECODED_BYTES } from "$lib/offline/limits";
import type {
    OfflineAssetV1,
    OfflinePackageRecordsV1,
    OfflineProblemV1,
} from "$lib/offline/types";
import { OfflineParseError } from "$lib/offline/parse";
import {
    assertBodyLimit,
    assertOfflineOrigin,
    offlineErrorResponse,
    requireOfflineUser,
} from "$lib/server/offline/http";

type MaterializingPage = {
    page_index: number;
    records: OfflinePackageRecordsV1;
};

async function finalizePages(input: {
    packageId: string;
    checkoutId: string;
    packageRevision: string;
    pages: MaterializingPage[];
}) {
    const seenAssets = new Set<string>();
    const finalized = [];
    for (const page of input.pages.sort((a, b) => a.page_index - b.page_index)) {
        const assets: OfflineAssetV1[] = [];
        const problems: OfflineProblemV1[] = [];
        for (const problem of page.records.problems) {
            const problemAssetRecords = await problemAssets({
                statement: problem.statement,
                choices: problem.choices,
                officialSolutions: problem.officialSolutions,
            });
            problems.push({
                ...problem,
                assetKeys: problemAssetRecords.map((asset) => asset.key),
            });
            for (const asset of problemAssetRecords) {
                if (seenAssets.has(asset.key)) continue;
                seenAssets.add(asset.key);
                assets.push(asset);
            }
        }
        // Parse before hashing and before storing: the client can only verify
        // the contract shape it parses, so that is what the checksum must cover.
        const records: OfflinePackageRecordsV1 = parseRecords({
            ...page.records,
            problems,
            assets,
        });
        const checksumInput = {
            packageId: input.packageId,
            checkoutId: input.checkoutId,
            packageRevision: input.packageRevision,
            pageIndex: page.page_index,
            records,
        };
        const decodedBytes = canonicalByteLength(checksumInput);
        if (decodedBytes > PAGE_MAX_DECODED_BYTES) {
            throw new Error("OFFLINE_BATCH_TOO_LARGE:page");
        }
        finalized.push({
            pageIndex: page.page_index,
            records,
            checksum: await pageChecksum(checksumInput),
            decodedBytes,
        });
    }
    return finalized;
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
    await requireOfflineUser(locals);
    assertOfflineOrigin(request, url);
    assertBodyLimit(request);

    let body;
    try {
        body = parsePackageCreateRequest(await request.json());
        body.scope = normalizeScope(body.scope);
    } catch (cause) {
        return offlineErrorResponse(
            cause instanceof OfflineParseError
                ? new Error(`OFFLINE_OPERATION_INVALID:${cause.message}`)
                : cause,
        );
    }

    try {
        const { data: begun, error: beginError } = await locals.supabase.rpc(
            "offline_begin_package",
            {
                p_package_id: body.packageId,
                p_request_id: body.requestId,
                p_device_id: body.deviceId,
                // The resolver receives the normalized scope plus an internal
                // membership bound. `goal_scope_canonicals` ignores unknown
                // keys; the SQL function removes this key before calling it.
                p_scope: { ...body.scope, problemLimit: body.problemLimit },
                // PostgREST accepts SQL null here; generated function args do
                // not preserve nullable parameter metadata.
                p_session_id: body.session.sessionId as number,
                p_session_name: body.session.name as string,
                p_session_settings: body.session.settings,
            },
        );
        if (beginError) throw beginError;
        const created = parsePackageCreated(begun);
        const { data: checkout, error: checkoutError } = await locals.supabase
            .from("offline_checkouts")
            .select("status")
            .eq("id", created.checkoutId)
            .single();
        if (checkoutError) throw checkoutError;
        if (checkout.status !== "materializing") return json(created);

        const { data: pages, error: pagesError } = await locals.supabase
            .from("offline_package_pages")
            .select("page_index, records")
            .eq("checkout_id", created.checkoutId)
            .order("page_index");
        if (pagesError) throw pagesError;
        const finalized = await finalizePages({
            packageId: created.packageId,
            checkoutId: created.checkoutId,
            packageRevision: created.packageRevision,
            pages: pages as MaterializingPage[],
        });
        const { data, error: finalizeError } = await locals.supabase.rpc(
            "offline_finalize_package",
            { p_checkout_id: created.checkoutId, p_pages: finalized },
        );
        if (finalizeError) throw finalizeError;
        return json(parsePackageCreated(data));
    } catch (cause) {
        return offlineErrorResponse(cause);
    }
};
