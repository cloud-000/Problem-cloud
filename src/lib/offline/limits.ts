/**
 * V1 package, page, and sync limits (`docs/offline-contracts.md` §9).
 *
 * These are conservative defaults. Corpus and device measurements may change
 * their *values* before release; they do not change the wire or repository
 * contract, which is why they live in one module rather than being written into
 * each validator.
 *
 * The hard rule these encode: package membership is bounded only by the
 * user-visible requested amount. Exceeding a storage/payload limit rejects the
 * download and asks the user to lower that amount or narrow the filters; paging
 * never applies another hidden truncation.
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** Canonicals in one package. */
export const PACKAGE_MAX_CANONICALS = 10_000;
/** Default explicit membership size offered by download UI. */
export const DOWNLOAD_DEFAULT_PROBLEMS = 20;
/** Canonical JSON in one package, excluding media. */
export const PACKAGE_MAX_JSON_BYTES = 50 * MIB;
/** Package including required image assets. Enforced cumulatively while staging,
 *  because third-party media lengths are not always knowable up front. */
export const PACKAGE_MAX_TOTAL_BYTES = 250 * MIB;

/** Problems in one download page. */
export const PAGE_MAX_PROBLEMS = 250;
/** Decoded canonical JSON in one page. HTTP compression does not change it. */
export const PAGE_MAX_DECODED_BYTES = 2 * MIB;
/** Generous per-collection ceilings so one malformed page cannot exhaust memory. */
export const PAGE_MAX_PLACEMENTS = 4 * PAGE_MAX_PROBLEMS;
export const PAGE_MAX_ASSETS = 8 * PAGE_MAX_PROBLEMS;

/** Operations the client sends per sync request. */
export const SYNC_MAX_OPERATIONS = 100;
/** Encoded JSON the client sends per sync request. */
export const SYNC_MAX_REQUEST_BYTES = 512 * KIB;
/** Answer text on one submission operation. */
export const SYNC_MAX_ANSWER_BYTES = 64 * KIB;
/** Dependencies declared on one operation. */
export const SYNC_MAX_DEPENDENCIES = 16;

/** Packages go stale after five days: a warning, never a block. */
export const PACKAGE_FRESHNESS_MS = 5 * 24 * 60 * 60 * 1000;

/** Headroom demanded above a new package (and its staging copy) before download. */
export const STORAGE_RESERVE_BYTES = 20 * MIB;
/** Cap on a download when `navigator.storage.estimate()` gives us nothing usable. */
export const STORAGE_BLIND_CAP_BYTES = 25 * MIB;

/** Scope-array ceilings, so a hostile or corrupt scope cannot blow up a query. */
export const SCOPE_MAX_TOPICS = 32;
export const SCOPE_MAX_SERIES = 256;
