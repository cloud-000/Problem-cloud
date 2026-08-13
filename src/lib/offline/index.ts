/**
 * The offline module's public surface.
 *
 * Everything the app touches goes through here: contracts and their parsers, the
 * versioned repository, the query engine, and the connectivity state machine.
 * Fixtures are deliberately **not** re-exported — they are test/dev data and
 * importing them from app code would pull a sample corpus into the bundle.
 */

export * from "./types";
export * from "./limits";
export {
    OfflineParseError,
    tryParse,
    type Parser,
} from "./parse";
export {
    MASTERY_VALUES,
    ENGAGEMENT_VALUES,
    countsAgree,
    normalizeScope,
    parseOperation,
    parsePackageCreated,
    parsePackagePage,
    parsePracticeQuery,
    parseScope,
    parseSyncError,
    parseSyncRequest,
    parseSyncResponse,
    parseSyncResult,
} from "./contracts";
export {
    assetKey,
    canonicalByteLength,
    canonicalJson,
    normalizeAssetUrl,
    pageChecksum,
    sha256Base64Url,
} from "./checksum";
export { assetKeysAgree, problemAssetKeys, problemAssets, problemImageUrls } from "./assets";
export { OfflineClock, offlineClock, newUUID, type LocalEventStamp } from "./clock";
export {
    effectiveProgress,
    groupByCanonical,
    hasPriorActivity,
    type EffectiveProgress,
    type OrganizationOverride,
} from "./overlay";
export {
    candidateIsMultipleChoice,
    candidateMatchesScope,
    coverageOf,
    matchesAttributes,
    missingCoverage,
    newModeEligible,
    orderCandidates,
    placementMatchesScope,
    runPracticeQuery,
    seededRank,
    toPracticeProblem,
    type QueryCandidate,
} from "./query";
export {
    OFFLINE_DB_NAME,
    OFFLINE_SCHEMA_VERSION,
    OFFLINE_STORES,
    STORE,
    type StoreName,
} from "./schema";
export {
    OfflineQuotaExceeded,
    OfflineStorageUnavailable,
    type OfflineStorage,
    type OfflineTx,
} from "./storage";
export { createMemoryStorage, type MemoryStorage } from "./memory";
export {
    createIdbStorage,
    createOfflineStorage,
    indexedDBAvailable,
    openOfflineDatabase,
    upgradeSchema,
} from "./idb";
export {
    MEDIA_CACHE_PREFIX,
    OfflineAssetUnavailable,
    cacheStorageAvailable,
    createCacheStorageMediaStore,
    createMemoryMediaStore,
    mediaCacheName,
    type OfflineMediaStore,
} from "./media";
export {
    OfflinePackageInconsistent,
    OfflinePackageTooLarge,
    OfflineRepository,
    OfflineUserMismatch,
    type OfflineRepositoryOptions,
} from "./repository";
export {
    canFlush,
    isOffline,
    nextConnectivity,
    type ConnectivityEvent,
    type ConnectivityState,
} from "./connectivity";
