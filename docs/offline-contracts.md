# Offline Mode — V1 Contracts

> [!IMPORTANT]
> **Status: Session 1 server spine implemented (2026-08-13).** §1, §3, §4, §5
> and §6 are exercised against fixture packages in `src/lib/offline/`; §2, §7,
> and §8 now have declarative schema, two-phase materialization/package
> endpoints, transactional sync, checkout lifecycle, and pgTAP coverage. Two local
> integration adjustments: stage `OfflinePackageCreatedV1.baseState` and promote
> it atomically in `commitPackage` instead of writing the fixture snapshot just
> after commit, and replace the service worker's arbitrary media-cache scan with
> revision-addressed media URLs. The browser download/recovery coordinator and
> trainer integration remain deliberately unimplemented. If a code
> change needs a different wire shape, query meaning, persistence rule, or sync
> result, update this contract before or with that change.

The downloaded package is a local read replica for a server-resolved scope. It
is not a queue. The first UI consumer is New-mode practice, but the package and
repository preserve the facts needed by later modes.

This document settles five boundaries:

1. package creation and paginated download;
2. normalized local records and atomic installation;
3. local practice queries;
4. the snapshot-plus-overlay repository;
5. idempotent synchronization.

---

## 1. Shared primitives

These examples are TypeScript contracts. Production code should place them in a
shared `$lib/offline/` module and validate every network payload at runtime; a
TypeScript assertion alone is not validation.

```ts
type UUID = string;
type ISOInstant = string;
type Cursor = string;

type OfflineScope = {
    topic: string[];
    seriesIds: string[];
    seriesScopes: Record<
        string,
        { divisions: string[]; formats: string[] }
    >;
};

type PackageState = "staging" | "ready" | "stale";
```

`OfflineScope` deliberately omits `yearRange`. The SQL resolver accepts it, but
the shared goal/practice UI does not author it yet. Add it here only when that
shared UI contract changes.

IDs supplied by the browser are UUIDs generated with `crypto.randomUUID()`.
Integer database IDs remain numbers within JavaScript's safe range; runtime
parsers reject unsafe integers.

---

## 2. Package creation and download

Package creation is an authenticated server operation. The server derives the
user from the validated session and never accepts `userId` in the request.

### 2a. Request

```ts
type OfflinePackageCreateRequestV1 = {
    version: 1;
    /** Stable logical package edited/refreshed over time. */
    packageId: UUID;
    /** Fresh per materialization attempt; idempotency key for retries. */
    requestId: UUID;
    deviceId: UUID;
    scope: OfflineScope;
    /** First-slice session settings; must resolve to practice/New mode. */
    session: {
        /** Null initially; the owned dedicated session id on refresh. */
        sessionId: number | null;
        name: string | null;
        settings: PracticeSettings;
    };
};
```

Validation rules:

- `packageId` is the browser-owned identity of the logical local package.
- `requestId` is new for each initial download or refresh. Retrying the same
  request is idempotent; a refresh never mutates the checkout/revision still
  referenced by older pending operations.
- `deviceId` identifies one browser installation, not a person or secret.
- Scope arrays are deduplicated, bounded, and normalized before resolution.
- `session.settings.format` must be `"practice"` and `mode` must be `"new"`
  for the first shipping slice.
- The endpoint rejects an empty whole-catalog scope if it exceeds the configured
  package limit; it never silently samples or truncates it.

```ts
type OfflinePackageBaseStateV1 = {
    playerRating: PlayerRating | null;
    session: PracticeSessionRow;
};
```

### 2b. Creation response

```ts
type OfflinePackageCreatedV1 = {
    version: 1;
    packageId: UUID;
    requestId: UUID;
    checkoutId: UUID;
    sessionId: number;
    normalizedScope: OfflineScope;
    contentRevision: string;
    packageRevision: string;
    personalStateAt: ISOInstant;
    downloadedAt: ISOInstant;
    problemCount: number;
    placementCount: number;
    assetCount: number;
    estimatedBytes: {
        json: number;
        media: number | null;
        total: number | null;
    };
    pageSize: number;
    firstCursor: Cursor | null;
    /** Frozen session/rating snapshot committed with this revision. */
    baseState: OfflinePackageBaseStateV1;
};
```

The creation transaction creates or reselects the same package checkout for a
retried `requestId`. Initial creation also creates the dedicated
`practice_sessions` row; refresh validates and reuses the supplied owned
session. It captures a stable package revision. Every subsequent page belongs
to that exact revision; content changing during the download must not mix
revisions.

`baseState.session.id` must equal `sessionId`, belong to the authenticated user,
and carry the accepted New/practice settings. The base state is stored with the
checkout so a retried creation response returns the identical snapshot.

To make this promise real across separate HTTP requests, creation is a retryable
two-phase server workflow:

1. a narrow database function resolves the scope and atomically stores the
   normalized logical page records under a `materializing` checkout; then
2. the SvelteKit endpoint reads those stored records, computes RFC 8785 checksums
   with the shared TypeScript canonicalizer used by the browser, and calls a
   narrow finalize function that stores all checksums and marks the checkout
   `issued`.

Page requests read only finalized immutable rows; they never rerun live joins
behind an opaque cursor. A crash between phases leaves a non-downloadable
`materializing` checkout, and retrying the same `requestId` resumes checksum
finalization. Retrying a completed request returns the same issued revision
while its pages remain available. This preserves a single database snapshot and
one checksum implementation without relying on PostgreSQL JSON serialization to
match RFC 8785.

`contentRevision` identifies catalog content. `packageRevision` identifies the
resolved membership and personal-state snapshot used by this download. Both are
opaque server-generated UUIDs; clients compare them for equality and do not
parse them.

### 2c. Page response

```ts
type OfflinePackagePageV1 = {
    version: 1;
    packageId: UUID;
    checkoutId: UUID;
    packageRevision: string;
    pageIndex: number;
    nextCursor: Cursor | null;
    counts: {
        memberships: number;
        problems: number;
        placements: number;
        assets: number;
        personalStates: number;
        ratings: number;
    };
    checksum: string;
    records: {
        memberships: OfflinePackageMembershipV1[];
        problems: OfflineProblemV1[];
        placements: OfflinePlacementV1[];
        assets: OfflineAssetV1[];
        personalStates: OfflinePersonalStateV1[];
        ratings: OfflineProblemRatingV1[];
    };
};
```

The cursor is opaque. Pages have a deterministic order within a package
revision. Retrying the same cursor returns the same logical records and
checksum. The last page has `nextCursor: null`.

The checksum is the base64url SHA-256 digest of the UTF-8 RFC 8785 canonical
JSON serialization of
`{ packageId, checkoutId, packageRevision, pageIndex, records }`.
HTTP compression does not change it. V1 accepts at most 250 problems and 2 MiB
of decoded canonical JSON per page; the server may return a smaller page.

### 2d. Normalized package records

```ts
type OfflinePackageMembershipV1 = {
    packageId: UUID;
    packageRevision: string;
    canonicalId: number;
};

type OfflineProblemV1 = {
    canonicalId: number;
    contentRevision: string;
    statement: string | null;
    topic: string | null;
    choices: string[] | null;
    answerIndex: number | null;
    answerStatus:
        | "known"
        | "source_missing"
        | "not_applicable"
        | "needs_review"
        | null;
    officialSolutions: string[] | null;
    verified: boolean;
    isComputational: boolean;
    responseKind:
        | "mcq"
        | "short_answer"
        | "proof"
        | "construction"
        | "estimation"
        | "interactive"
        | "unknown"
        | null;
    aopsId: number | null;
    tags: string[] | null;
    difficulty: number | null;
    quality: number | null;
    notes: string | null;
    builtAt: ISOInstant;
    assetKeys: string[];
};

type OfflineAssetV1 = {
    /** Base64url SHA-256 of the normalized absolute URL. */
    key: string;
    url: string;
    kind: "problem-image";
    required: true;
};

type OfflinePlacementV1 = {
    packageRevision: string;
    placementId: number;
    canonicalId: number;
    testId: number | null;
    problemNumber: number;
    topic: string | null;
    test: {
        name: string;
        seriesId: number | null;
        division: string | null;
        format: string | null;
        year: number | null;
        aopsCategoryId: string | null;
    } | null;
    series: {
        id: number;
        name: string;
    } | null;
};

type OfflineProblemRatingV1 = {
    canonicalId: number;
    rating: number;
    rd: number;
    attempts: number;
};

type OfflinePersonalStateV1 = {
    userId: UUID;
    canonicalId: number;
    progress: ProblemProgress | null;
};
```

This is the complete v1 durable problem projection. `test_id` and `n` belong to
`OfflinePlacementV1`; `canonical_id`, `sync_key`, and the row's own `id` are
represented by `canonicalId`; generated embeds are normalized into ratings and
personal state. The endpoint uses an explicit select and runtime validator,
never `*`, so a new database column cannot silently alter the protocol.

`assetKeys` covers every image reference parsed from the statement, choices,
and official solutions, including `[asy=<url>]`, `[img]`, and markdown image
syntax. The browser fetches those URLs into a revision-scoped staging
CacheStorage cache. A package becomes ready only after all required assets are
present. Offline rendering rewrites each known reference to the revision-addressed
same-origin media URL described in §9, and the service worker resolves it only
against that revision's cache. Refreshes use a new cache; startup garbage
collection removes orphaned staging caches after consulting IndexedDB. This
deliberately avoids storing large opaque image responses in IndexedDB while
preserving the old ready revision on failure.

Membership is based only on `goal_scope_canonicals`. It includes ungradeable,
seen, solved, ignored, and unrated problems because those are query predicates,
not package-membership predicates. A local New query filters them later.

For every matching canonical, download every placement necessary to answer
queries within the package's scope and to reconstruct the current display. The
materializer must not pretend that the canonical row's own test is the only
placement through which it can match.

### 2e. Player and session snapshot

`OfflinePackageCreatedV1.baseState` is the frozen player rating and dedicated
session captured by `packageRevision`. There is no separate metadata endpoint in
v1. Keeping it in the creation response makes a retry self-contained and avoids
a second wire shape.

---

## 3. Local installation

### What `stagePackagePage` means

Earlier notes used the ambiguous name `installPage`. It did **not** mean install
a Svelte page, route, or application screen. It meant:

> Validate and atomically store one page of a paginated package download in an
> invisible staging revision.

The contract now calls this `stagePackagePage`.

```ts
interface OfflinePackageInstaller {
    beginPackage(created: OfflinePackageCreatedV1): Promise<void>;
    stagePackagePage(page: OfflinePackagePageV1): Promise<void>;
    commitPackage(input: {
        packageId: UUID;
        checkoutId: UUID;
        packageRevision: string;
        expectedProblems: number;
        expectedPlacements: number;
        expectedAssets: number;
    }): Promise<void>;
    abortStagingPackage(packageId: UUID): Promise<void>;
}
```

### `beginPackage`

- Creates or resets only the staging revision for `packageId`.
- Does not disturb the previous ready revision during a refresh.
- Stores expected counts, revisions, and the next expected cursor/page index.
- Stages `baseState`; it does not publish or overwrite the active session
  snapshot during a refresh.

### `stagePackagePage`

It first fetches any newly declared assets into the revision's staging cache.
It then performs one IndexedDB transaction that:

1. runtime-validates the complete response;
2. verifies package, checkout, revision, expected page index, and checksum;
3. upserts immutable content records by `(canonicalId, contentRevision)`;
4. upserts placements and frozen personal/rating records;
5. writes membership references for the staging revision;
6. records the page checksum and next cursor;
7. advances staging progress.

It is idempotent for an already-staged page with the same checksum. The same
page index with another checksum fails the package as inconsistent. Staged data
is never visible to ordinary queries.

### `commitPackage`

It first verifies every required asset in the revision's staging CacheStorage
cache. It then uses one IndexedDB transaction to verify:

- the final page was received;
- all page indexes are contiguous;
- accumulated counts match package creation and page declarations;
- every membership has a corresponding problem record;
- every record belongs to the expected revision.

It then marks the staging revision ready and atomically makes it the package's
active revision, promotes its staged personal/rating rows, and promotes the
staged session/player-rating snapshot. A ready package can therefore never be
observed without its matching session snapshot. Only after that may the old
revision and now-unreferenced content be garbage-collected.

### `abortStagingPackage`

Deletes incomplete membership/page metadata and unreferenced staging records.
It never deletes the previous ready revision or any outbox/local-overlay record.

### IndexedDB v1 stores and indexes

The first implementation uses one versioned database and these logical stores:

| Store | Primary key | Required indexes |
|---|---|---|
| `packages` | `[userId, packageId]` | user/state, user/active revision |
| `packageMembership` | `[userId, packageRevision, canonicalId]` | package revision, canonical |
| `problems` | `[userId, contentRevision, canonicalId]` | user/content/topic, canonical |
| `placements` | `[userId, packageRevision, placementId]` | package/canonical, package/test, package/series |
| `ratings` | `[userId, canonicalId]` | user/rating |
| `personalState` | `[userId, canonicalId]` | user/mastery, user/engagement, user/times-seen |
| `sessions` | `[userId, sessionId]` | user/status |
| `localSubmissions` | `[userId, clientKey]` | user/session/sequence, user/canonical |
| `organizationOverrides` | `[userId, canonicalId, axis]` | user/sequence |
| `outbox` | `[userId, sequence]` | user/state, operation id (unique) |
| `meta` | `key` | none |

The implementation adds three revision-scoped stores to this list — `assets`,
`stagedRatings` and `stagedPersonalState`, all keyed
`[userId, packageRevision, …]` — for one reason. Membership, placements and
content are already invisible while staging because they are keyed by package
revision, but ratings and personal state are shared per `(user, canonical)` **on
purpose**, so that one sync updates every overlapping package at once. Writing
them directly during a refresh would therefore publish a revision that has not
committed. They are staged revision-scoped and moved into the shared stores by
`commitPackage`. `assets` is revision-scoped for the same reason and doubles as
the record of what the revision's media cache must contain, which is what
`commitPackage` verifies before promoting.

Compound scope predicates still run in pure TypeScript after these indexes
produce the package-bounded candidate set. With the 10,000-canonical package
limit, v1 does not add an inverted-index subsystem prematurely.

Schema upgrades are additive and transactional. An incompatible old package may
be marked `incompatible` and redownloaded, but an upgrade must always preserve
and parse versioned outbox records. Application startup never responds to a
migration error by deleting the database.

---

## 4. Local query contract

The query contract expresses trainer meaning, not IndexedDB mechanics.

```ts
type PracticeQueryV1 = {
    version: 1;
    userId: UUID;
    packageIds: UUID[];
    sessionId: number | null;
    mode: "new";
    filters: {
        topic: string[];
        seriesIds: string[];
        seriesScopes: Record<
            string,
            { divisions: string[]; formats: string[] }
        >;
        ratingBand: [number, number] | null;
        verifiedOnly: boolean;
        computational: boolean | null;
        answerAvailability: "with" | "without" | "any";
        solutionAvailability: "with" | "without" | "any";
        mastery: (Mastery | "unassessed")[];
    };
    excludeCanonicalIds: number[];
    order: {
        kind: "seeded-random" | "nearest-rating";
        seed: string;
        ratingCenter: number | null;
    };
    limit: number;
};

type PracticeQueryResultV1 =
    | {
          status: "ok";
          problems: OfflinePracticeProblemV1[];
          availableCount: number;
      }
    | {
          status: "exhausted";
          problems: [];
          availableCount: 0;
      }
    | {
          status: "not_downloaded";
          problems: [];
          missing: {
              topic: string[];
              seriesIds: string[];
          };
      }
    | {
          status: "package_unavailable";
          problems: [];
          reason: "missing" | "staging" | "incompatible";
      };
```

`OfflinePracticeProblemV1` is the UI-ready normalized problem plus its effective
progress and frozen rating. It is assembled at query time; mutable personal
state is not copied into durable problem content.

### Query rules

1. The union of ready `packageIds` is the outer candidate set.
2. The requested user must own every package and match the active offline user.
3. Scope filters are placement-aware. A canonical passes when at least one of
   its downloaded placements satisfies the whole topic/series/division/format
   clause, matching `goal_scope_canonicals` semantics.
4. New mode requires a nonblank statement, a comparable answer under the current
   `hasComparableAnswer` contract, no effective prior factual activity, not
   ignored, and no current-session/external exclusion.
5. `answerAvailability`, `solutionAvailability`, `verifiedOnly`,
   `computational`, mastery, and rating filters match trainer semantics.
6. `nearest-rating` uses the frozen problem rating and the current local shadow
   center. Unrated problems participate through the same documented fallback as
   online New mode.
7. Seeded ordering is deterministic for `(seed, canonicalId)` and does not use
   `Math.random()` directly.
8. Queries may narrow downloaded membership. A requested series/topic not
   represented by the selected packages yields `not_downloaded`, not
   `exhausted` and not a network request.

The first implementation may retrieve candidates through coarse IndexedDB
indexes and apply compound predicates in pure TypeScript. Contract tests must
run the same fixtures through the online eligibility mirror and local engine.

---

## 5. Snapshot-plus-overlay repository

```ts
interface OfflinePracticeRepositoryV1
    extends OfflinePackageInstaller {
    listPackages(userId: UUID): Promise<OfflinePackageManifestV1[]>;
    queryProblems(query: PracticeQueryV1): Promise<PracticeQueryResultV1>;
    getProblem(input: {
        userId: UUID;
        packageIds: UUID[];
        canonicalId: number;
    }): Promise<OfflinePracticeProblemV1 | null>;
    loadSession(userId: UUID, sessionId: number): Promise<OfflineSessionV1 | null>;
    setCurrentProblem(input: OfflineCurrentProblemInputV1): Promise<void>;
    recordSubmission(input: OfflineSubmissionInputV1): Promise<LocalSubmissionV1>;
    setMastery(input: OfflineMasteryInputV1): Promise<void>;
    setEngagement(input: OfflineEngagementInputV1): Promise<void>;
    finishSession(input: OfflineFinishSessionInputV1): Promise<void>;
    pendingOperations(userId: UUID, limit: number): Promise<OfflineOperationV1[]>;
    acknowledgeSync(result: OfflineSyncResponseV1): Promise<void>;
}
```

### Effective progress

The repository stores frozen server `ProblemProgress` as base state. It derives
effective v1 state by folding unacknowledged local submissions in `sequence`
order:

- every submission increments `times_seen` and `total_time_ms`;
- a skip increments `times_skipped`;
- a graded non-skip increments `times_reviewed`;
- a correct graded submission increments `times_correct`;
- the newest local graded outcome updates provisional `last_correct`;
- local mastery/engagement overrides win over the frozen values;
- `solved` derives from effective `times_correct > 0`.

V1 does not invent provisional `ease_factor`, `repetitions`, `interval_days`, or
`next_review_at`. Those remain frozen server values and are marked stale after a
local graded submission. Review mode therefore remains unsupported until its
local scheduling policy is specified.

### Atomic local writes

`recordSubmission` performs one IndexedDB transaction that:

1. allocates the next per-user sequence;
2. creates a browser UUID operation/client key;
3. appends the complete local submission;
4. appends its `submission` outbox operation;
5. updates session history/counters and clears the current problem;
6. updates the effective overlay indexes used by later queries.

If any step fails, none becomes visible. Mastery and engagement operations
coalesce by `(userId, canonicalId, type)` while pending: the last local intent is
what the server needs, provided its dependency on the relevant submission is
preserved.

---

## 6. Outbox operation contract

```ts
type OfflineOperationV1 = {
    version: 1;
    id: UUID;
    userId: UUID;
    checkoutId: UUID;
    packageId: UUID;
    sessionId: number;
    sequence: number;
    runtimeId: UUID;
    monotonicOffsetMs: number;
    occurredAt: ISOInstant;
    dependsOn: UUID[];
    state: "pending" | "syncing" | "failed";
} & (
    | { type: "submission"; payload: OfflineSubmissionPayloadV1 }
    | { type: "mastery"; payload: OfflineMasteryPayloadV1 }
    | { type: "engagement"; payload: OfflineEngagementPayloadV1 }
    | { type: "session-finish"; payload: OfflineSessionFinishPayloadV1 }
);

type OfflineSubmissionPayloadV1 = {
    clientKey: UUID;
    canonicalId: number;
    selectedChoice: number | null;
    answer: string | null;
    isCorrect: boolean | null;
    skipped: boolean;
    flagged: boolean;
    elapsedMs: number;
    source: "practice";
    triesUsed: number;
};

type OfflineMasteryPayloadV1 = {
    canonicalId: number;
    mastery: Mastery | null;
};

type OfflineEngagementPayloadV1 = {
    canonicalId: number;
    engagement: Engagement | null;
};

type OfflineSessionFinishPayloadV1 = {
    endedAt: ISOInstant;
};
```

The client never sends `user_id`, `created_at`, encounter annotations, rating
values, progress counters, or server submission IDs as authoritative payload.
The server derives ownership, assigns receipt-order `created_at`, and clamps
`occurred_at` to the closed interval from the checkout's server-issued
`downloaded_at` through the sync transaction time. Outbox `sequence`, not wall
time, orders operations. Existing canonicalization/progress/rating triggers own
derived state.

---

## 7. Sync wire contract

### 7a. Request

```ts
type OfflineSyncRequestV1 = {
    version: 1;
    deviceId: UUID;
    checkoutId: UUID;
    packageId: UUID;
    packageRevision: string;
    operations: OfflineOperationV1[];
};
```

Rules:

- Operations are strictly increasing by `sequence` and belong to one user,
  checkout, package, and session.
- The server derives the user and rejects a mismatch without applying anything.
- The client sends at most 100 operations and 512 KiB of encoded JSON per
  request. The endpoint rejects more than 100 operations, a body over 1 MiB, an
  answer over 64 KiB, or more than 16 dependencies on one operation.
- V1 applies the request as one database transaction. A permanent invalid
  operation rejects the complete batch; the client marks it failed and does not
  skip past it automatically.
- Transport failure or an unknown response is retryable with the identical
  operation IDs and `clientKey` values.

### 7b. Success response

```ts
type OfflineSyncResponseV1 = {
    version: 1;
    status: "applied";
    checkoutId: UUID;
    acknowledgedOperationIds: UUID[];
    submissions: {
        clientKey: UUID;
        submissionId: number;
        createdAt: ISOInstant;
        occurredAt: ISOInstant;
    }[];
    overlaps: {
        canonicalId: number;
        kind:
            | "activity_since_download"
            | "mastery_replaced"
            | "engagement_replaced";
    }[];
    authoritative: {
        session: PracticeSessionRow;
        playerRating: PlayerRating | null;
        personalStates: OfflinePersonalStateV1[];
        problemRatings: OfflineProblemRatingV1[];
    };
    syncedAt: ISOInstant;
};
```

The response includes authoritative state for every canonical touched by the
batch. `acknowledgeSync` writes that base state, removes only acknowledged
operations/local submissions, rebuilds affected overlays, and updates the
checkout in one IndexedDB transaction.

An existing `(user_id, client_key)` is returned as the same successful logical
submission. It is not a batch error and does not create another row.

### 7c. Error response

```ts
type OfflineSyncErrorV1 = {
    version: 1;
    status: "error";
    code:
        | "auth_required"
        | "owner_mismatch"
        | "checkout_invalid"
        | "package_revision_invalid"
        | "batch_too_large"
        | "operation_invalid"
        | "conflict"
        | "temporary";
    retryable: boolean;
    operationId?: UUID;
    message: string;
};
```

`auth_required` leaves the outbox untouched and asks the user to sign in.
Validation errors retain the affected operation and require an explicit retry
after code/data repair or an explicit user discard flow. A client must never
interpret an error as an acknowledgement.

---

## 8. Database contract

The declarative schemas add:

```sql
alter table public.submissions
  add column client_key uuid,
  add column occurred_at timestamp with time zone;

create unique index submissions_user_client_key_uidx
  on public.submissions(user_id, client_key)
  where client_key is not null;
```

`created_at` remains server receipt/rating/progress order. `occurred_at` is
bounded display/audit metadata and never silently replaces `created_at` in
existing consumers.

`offline_checkouts` must minimally persist:

```sql
id                uuid primary key,
package_id        uuid not null,
request_id        uuid not null,
user_id           uuid not null,
device_id         uuid not null,
session_id        bigint,
scope             jsonb not null,
content_revision  text not null,
package_revision  text not null,
downloaded_at     timestamptz not null,
last_synced_at    timestamptz,
completed_at      timestamptz,
expires_at        timestamptz,
status            text not null
```

Stable download pages are transiently persisted as:

```sql
checkout_id       uuid not null references public.offline_checkouts(id),
page_index        integer not null,
records           jsonb not null,
checksum          text,
decoded_bytes     integer not null,
created_at        timestamptz not null,
primary key (checkout_id, page_index)
```

The exact table name may be `offline_package_pages`. `checksum` is nullable only
while its checkout is `materializing`; checksum finalization supplies every
checksum before changing the checkout to `issued`. These rows are the immutable
retry surface for one `packageRevision`, not durable user history. The separate
ready-finalize endpoint deletes them after the local package is committed;
unfinished rows expire after seven days. At most two unfinalized
materializations may exist per user.
Once pages expire, resuming that revision returns `package_revision_invalid` and
the client must explicitly restart the download, which creates a new revision
without deleting any prior ready local package.

The catalog also needs a singleton server-owned revision row advanced by every
successful content sync, including deletes. Package creation captures this UUID
as `contentRevision`; deriving it from `max(problems.built_at)` is insufficient.

The final table also needs foreign keys, status checks, owner indexes, RLS, and
grants. A unique `(user_id, request_id)` constraint makes one materialization
attempt idempotent. Many immutable checkouts may refer to one logical
`package_id`; refresh never rewrites the checkout referenced by pending work.

V1 requires this row; it is advisory provenance, not a lock. `status` is one of
`materializing`, `issued`, `ready`, `closed`, `abandoned`, or `expired`. The
database snapshot step writes `materializing`; checksum finalization writes `issued`; an
idempotent best-effort ready-finalize call after local commit writes `ready`.
Sync accepts both `issued` and `ready`, because losing ready-finalize must not
strand local work. Successful sync updates `last_synced_at` but does not move the
checkout into a terminal state: an installed package may create more offline
work later. Issued and ready rows do not expire automatically. After a refresh
or package deletion, a narrow close operation may mark an old checkout `closed`
only when the client says that revision is no longer active and its local outbox
contains no reference to it; closed rows are retained for 30 days. Explicit
discard writes `abandoned` and retains the row for 90 days. Only unfinished
`materializing` checkouts expire automatically after seven days. This leaves a
small provenance row durable for as long as unseen offline work could still
arrive, while the much larger page rows remain transient.
Owners may select their rows through RLS. Creation, finalize, sync, close,
abandon, and cleanup writes go only through their narrow functions/endpoints.

The materialization function must call `goal_scope_canonicals`, build every
logical page transactionally, and enforce the per-user/size limits. The endpoint
and checksum-finalize function complete the two-phase creation protocol above.
The sync function accepts the closed v1 operation representation and applies it
transactionally. The server endpoints validate requests and invoke those narrow
database functions. Neither is a general service-role write surface.

After schema changes, use the Supabase CLI diff/migration workflow and regenerate
`src/lib/types/database.types.ts`; never edit that generated file manually.

---

## 9. Resolved foundational decisions

These are v1 product constants, not questions for individual implementation
slices to answer differently.

### Shell and supported browsers

- Relocate the current authenticated `src/routes/+layout.server.ts` and
  `src/routes/+layout.ts` behavior into the `(app)` route group. The root layout
  remains presentation-only. The `(splash)` group gets its own anonymous client
  for public reads such as the welcome-page count; it does not inherit app auth
  data.
- `/offline` lives outside `(app)`, has no server or universal load, and is
  prerendered. It renders the limited offline shell directly from the local
  repository and never consumes cached auth data.
- Add Playwright as the production-browser harness. The release gate is
  Chromium 111+ and Safari/iOS 16.4+. Firefox 114+ is supported best-effort but
  is not a v1 release gate. Embedded Kindle/E-Ink browsers are explicitly
  unsupported for offline v1. The harness lives in `playwright.config.ts` and
  `e2e/*.e2e.ts` (that extension, not `.spec.ts`, so `bun test` does not collect
  them). Browsers are not vendored: run `bunx playwright install chromium
  webkit` once. Because this repository requires explicit authorization before
  running a build, the config does not start a server implicitly — set
  `PC_E2E_BASE_URL`, or `PC_E2E_START=1` to let it build and preview one.
- Foreground sync uses Web Locks where available and a BroadcastChannel lease
  fallback elsewhere; Background Sync is not required.

### Package and storage limits

- One v1 package may contain at most 10,000 canonicals, 50 MiB of canonical
  JSON, 250 MiB including required image assets, and 250 problems per page. A
  server estimate over the row/JSON limits is rejected before download. Because
  third-party media lengths are not always knowable up front, the browser also
  enforces the 250 MiB limit cumulatively while staging. Crossing it aborts the
  new revision. A package is never sampled.
- Before downloading, request persistent storage after the user's gesture when
  that API exists and call `navigator.storage.estimate()`. A persistence denial
  warns but does not block. Require room for the new package, its staging copy
  during refresh, and a 20 MiB reserve. If no usable estimate is available, cap
  the new download at 25 MiB and require deleting the old revision before a
  refresh.
- V1 never automatically evicts a ready package. Quota failure aborts staging,
  preserves the previous ready revision and every outbox record, and offers
  explicit package deletion or a narrower download.
- Missing IndexedDB, CacheStorage, or service-worker support produces an
  unsupported/storage-unavailable state before any checkout is created.

These limits are conservative defaults. Corpus and device measurements may
change their values before release, but do not alter the wire or repository
contract.

### Revisions and refresh

- Content sync advances an opaque server-owned catalog revision even when rows
  are deleted. `contentRevision` is that value; it is not inferred solely from
  `max(built_at)`.
- Every materialization creates an opaque UUID `packageRevision` pinned to the
  normalized scope, resolved membership, catalog revision, and personal-state
  snapshot. Cursors are valid only for that revision.
- Package freshness is five days. Staleness warns but does not prevent use.

### Conflict policy

- Server receipt order remains authoritative for submissions and ratings.
  Activity that happened on another device after download is reported as an
  overlap but does not reject valid offline work.
- Explicit offline mastery and engagement changes apply in outbox sequence at
  sync receipt and therefore win over an intervening online value. The response
  reports an overlap so the UI can disclose the replacement. V1 does not infer
  ordering from an untrusted device clock.

### First-slice UX

- Online Practice exposes `Download for offline` beside the scope/session
  settings. Confirmation shows normalized scope, problem/media estimates,
  required space, and the explicit warning that answer keys are stored locally.
- Download states are `estimating`, `downloading` (pages/assets and bytes),
  `ready`, `stale`, `failed`, and `storage-full`. Cancel removes only staging.
- The account may retain multiple ready packages, including overlapping ones.
  `/offline` lists them for the active local account. Opening one
  resumes its dedicated New-mode session; it does not silently combine packages.
  A later explicit multi-package query may do so through `packageIds`.
- When assembling an offline problem, known media references are rewritten to
  `/_offline/media?revision=<packageRevision>&url=<encoded-original-url>`. The
  service worker opens only that revision's cache and matches the decoded
  original URL; it never returns the first match from an arbitrary revision
  cache. The URL is routing metadata, not a credential.
- Five-day staleness shows a warning and an online-only Refresh action but never
  blocks practice. Refresh retains the old ready revision until commit.
- Delete is immediate only when the package has no pending operations. Otherwise
  the user must sync first or explicitly discard the named session and pending
  operation count.
- Coach, Discuss links, and other network-only actions are disabled with an
  offline explanation. Missing media is treated as package corruption, not as a
  silently incomplete problem.
- `auth-required` keeps all local work and offers sign-in. A different signed-in
  account cannot view or sync the active package.

---

## 10. Acceptance scenario

The first slice is not complete until an automated production-browser/database
scenario proves all of the following:

1. Sign in and create a Geometry/AMC package.
2. Download every stable page and atomically commit the package.
3. Verify a query can narrow the package but cannot expand into undownloaded
   Algebra content.
4. Reload without networking and open the dedicated session.
5. Query a New adaptive problem locally and answer it.
6. Answer a second problem, then restart the browser.
7. Continue offline without either problem being offered again.
8. Change mastery and verify another overlapping package observes the local
   override.
9. Reconnect with expired authentication and retain every operation while login
   is required.
10. Sign in as the owning user and begin sync.
11. Let the server commit, then lose the HTTP response.
12. Retry the identical batch and observe exactly two server submissions.
13. Apply the authoritative response and remove only acknowledged operations.
14. Refresh the package through staging; force a page failure and verify the
   previous ready revision still works.

Unit tests cover parsers, checksums, query predicates, overlays, ordering, and
acknowledgement. SQL tests cover ownership, canonicalization, idempotency,
transaction rollback, and live-rating equivalence. The browser test covers the
service worker, real IndexedDB lifecycle, restart, auth recovery, and retry.

---

## 11. Deferred contract extensions

- `yearRange` in the shared scope/editor contract;
- offline-created practice sessions and local-to-server session identity;
- List, Skipped, and Mixed query members;
- Review scheduling and provisional SM-2 policy;
- Test-mode ordered placements and atomic final submission;
- local Coach bootstrap, persistence, and anchor reconciliation;
- multi-account packages visible concurrently;
- service-worker Background Sync;
- SQLite/OPFS local implementation if measurements disqualify IndexedDB.

These extensions may widen discriminated unions and repository methods. They do
not change the central rule: the server resolves package membership, local
queries operate only within ready package membership, pending writes overlay the
snapshot, and the server database owns durable derived truth.
