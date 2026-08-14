# Offline Mode — Revised Design Proposal

> [!IMPORTANT]
> **Status: Session 3 data-source implementation and Practice-route migration
> phases 1–3 complete as of 2026-08-13; neutral Practice boot and release proof
> pending.** The offline *core and shell* have
> landed: self-hosted rendering assets, the credential-free `/offline` route with
> the authenticated load relocated into `(app)`, a minimal service worker, the
> versioned IndexedDB repository with staged package installation, the local
> New-mode query engine, the snapshot-plus-overlay state, and the typed outbox —
> fixture coverage, and the Session 1 server spine has landed: declarative
> Supabase package/checkout schema, retryable two-phase materialization, package
> endpoints, transactional idempotent sync, overlap reporting, lifecycle,
> migrations/types, and SQL tests. The browser now downloads/refreshes/deletes
> packages through those APIs, atomically promotes base state, routes media by
> revision, and foreground-syncs pending work with auth and multi-tab recovery.
> Downloaded packages now launch the normal `/practice` presentation through one
> route-bound online/offline data-source seam, with local grading, organization
> writes, session resume/finish, and runtime-only adaptive shadow selection. The
> transitional dedicated New-mode trainer is intentionally retained as a parity
> fallback until the shared lifecycle gates pass. Mid-session settings edits are
> disabled for the first integrated offline source; its downloaded snapshot stays
> fixed. The credential-free Practice boot and direct offline reload remain phase
> 4 work. See
> [`offline-practice-route-migration.md`](./offline-practice-route-migration.md).
> The full
> 14-step Playwright acceptance scenario is checked in; Chromium/WebKit execution
> and the remaining device/database measurements still gate release.
> §12 tracks exactly what is in and what is not; keep it current as each slice
> lands.
>
> The concrete v1 wire, query, repository, sync, and acceptance contracts live
> in [`offline-contracts.md`](./offline-contracts.md). The implementation lives
> in `src/lib/offline/`.

The product goal is a **downloaded local read replica for a defined scope**.
While online, a signed-in user downloads every problem and the supporting
metadata in a goal-shaped scope. While offline, supported app features query
that local dataset instead of Supabase, layer pending local work over the
downloaded snapshot, and sync raw writes exactly once after reconnecting.

The package is not a pre-drawn queue and is not tied conceptually to one order
of practice. It is a reusable local database boundary: queries may narrow what
was downloaded, but may never expand beyond it.

The architecture is viable, but the first draft had three unsafe assumptions:

1. a personalized SvelteKit `__data.json` response could be used as the offline
   identity cache;
2. backdated submissions could pass through the live progress/rating triggers
   without changing their meaning; and
3. repeatedly calling the current draw function would be a suitable way to
   materialize a reusable local dataset.

None is true. This revision separates the credential-free shell, downloaded
catalog data, local identity, and pending writes; keeps database truth in server
receipt order; and materializes the complete resolved scope in bulk.

---

## 1. Product boundary and first shipping slice

The architecture targets a general scoped local query source. The first shipping
slice is deliberately smaller than the storage/query foundation so the first
write-and-recovery path can be proven end to end.

The foundation supports:

- one signed-in account's downloaded data at a time;
- goal-shaped scope axes that the current UI actually authors: topic,
  `seriesIds`, and per-series division/format filters;
- every canonical problem reached by the scope, including current rating,
  progress, placement, answer, and solution metadata needed by local queries;
- reusable queries within the downloaded boundary rather than a fixed queue;
- a downloaded server snapshot plus an immediate local overlay of pending
  submissions, mastery, engagement, and session state;
- browser grading through `answersMatch`;
- local optimistic history and counters;
- idempotent foreground sync after the user's server session is valid again.

The first integrated shipping slice exposes:

- multiple retained downloads for one account, with exactly one package opened
  by an offline practice client at a time;
- one dedicated practice session with a real server id per package, launched
  into the normal `/practice` route and Practice presentation;
- **New** mode as the first enabled offline consumer of the general local query
  repository; unsupported modes are disabled with an explanation;
- offline reload/resume, grading, local history, and synchronization.

The first integrated shipping slice does **not** expose:

- arbitrary offline navigation through the authenticated app;
- root/free practice;
- Review, Skipped, Mixed, List, or Test modes;
- offline library, goals, history, progress, or analytics;
- offline Coach persistence or work-thread anchors;
- background sync while no authenticated page is open;
- simultaneous offline work for multiple accounts in one browser profile.

Those modes must not be designed out of the repository. New mode simply removes
the hardest encounter-reconstruction case from the first release: it never
intentionally repeats a previously seen problem. A dedicated, pre-created
session also avoids local-to-server session-id rewriting until offline-created
sessions are designed. Reusing the normal Practice UI does not broaden these
data semantics.

---

## 2. Local data layers and trust levels

Offline mode must not blur different kinds of persisted state.

| Layer | Contents | Authority | Lifetime |
|---|---|---|---|
| Versioned asset cache | JS, CSS, self-hosted fonts, KaTeX, neutral offline document | build | replaced per deployment |
| Revision-scoped media cache | statement/choice/solution images, including rendered Asymptote images | package snapshot | retained while its ready package revision is active |
| Local account marker | active user id and minimal display label; **no tokens or cookies** | convenience only | cleared on logout/account change |
| Package manifest | scope, membership, versions, counts, freshness, download state | server snapshot | refreshable/evictable |
| Shared catalog records | canonical problem content and placement/test/series metadata | server snapshot | retained while referenced by a package |
| Personal base state | frozen ratings, progress, mastery, engagement, and server sessions | server snapshot | refreshed after sync/package refresh |
| Local overlay | effective progress/session changes derived from pending local operations | provisional local state | reconciled after sync |
| Outbox | submissions and other pending operations | unsynced user work | never evicted for age or cache pressure |

Every IndexedDB record is keyed by `userId`. The currently active offline user
is a separate pointer, not an inference from whichever record happens to exist.
Opening offline data for user A after user B signs in is forbidden.

Problem content is stored once per user/content revision and packages reference
it through membership records. Overlapping downloads must not create independent
copies or independent personal progress. One canonical problem and one effective
personal state can belong to many packages.

Downloaded problem data includes answer keys. It is no more secret than the same
rows already returned to the browser online, but it is durable local data and
must be described honestly in the download UI. Logging out hides downloads
immediately. Synced packages may be deleted; pending outbox records must remain
sealed to their user id until that same account authenticates and syncs or
explicitly discards them.

---

## 3. Shell and identity: never cache personalized SvelteKit data

### 3a. Why `__data.json` is not the offline identity

`src/routes/+layout.server.ts` currently serializes `session`, `user`,
`profile`, and `cookies`. The reconstructed session contains access and refresh
tokens (`src/hooks.server.ts`). Caching that response would persist credentials
in CacheStorage and could resurrect the wrong account after logout or account
switching.

It is also unnecessary. A root layout server load is retained across ordinary
child navigation until one of its dependencies is invalidated; it is not fetched
on every client navigation merely because it exists.

Hard rules:

- never runtime-cache `__data.json`, `/_data.json`, API responses, Supabase
  responses, or authenticated HTML;
- never store access tokens, refresh tokens, cookie values, or the serialized
  `Session` in the offline database;
- never use a cached server response to decide that the user is authenticated;
- require a freshly validated server session before flushing.

### 3b. A neutral offline entry document

The service worker needs a credential-free document it can return when a
navigation cannot reach the server. The clean route is:

1. Move the authenticated root server/universal loads from `src/routes/` into
   the `(app)` route group, leaving the root layout presentation-only.
2. Add a neutral `/offline` route outside `(app)` that has no server data and is
   safe to prerender/cache.
3. Precache that document plus `build` and the deliberately selected files from
   `static` using `$service-worker`.
4. Use cache-first only for versioned build/static assets. Use network-first for
   navigations and fall back to the neutral offline document on a network
   failure.
5. The offline route reads the active account marker and complete packages from
   IndexedDB. With no valid package, it shows an explanation rather than an
   imitation of the signed-in app.

The service worker must not cache every successful GET opportunistically. The
app has personalized reads, answer-bearing payloads, and API responses whose
staleness rules differ; the IndexedDB repository owns the data cache explicitly.

### 3c. Connectivity is a state machine

`navigator.onLine` is only a hint. Track at least:

- `online`: a recent application request succeeded;
- `offline`: the browser reports offline or a connectivity probe failed;
- `auth-required`: the network is back but the session could not be refreshed;
- `syncing` / `sync-error`: connectivity exists and outbox work is being handled.

Do not clear local data because token refresh failed. On reconnect, validate the
session first, confirm its user id matches the outbox, then acquire the sync lock.
Refresh-token races between tabs can still require login; that is an auth state,
not data loss.

---

## 4. Self-host every critical rendering asset

`src/app.html` currently loads KaTeX from jsDelivr and Material Symbols Rounded
from Google Fonts; `layout.css` also imports Inter, JetBrains Mono, and Source
Serif 4 from Google Fonts. Without them, offline problems lose math rendering,
icons, or their intended typography.

Self-host:

- `katex.min.css`, `katex.min.js`, `auto-render.min.js`, and every KaTeX font
  referenced by the stylesheet;
- the Material Symbols Rounded variable-font subset used by the app;
- the text-font faces and weights actually used by the app.

Keep the existing icon extraction bias: `scripts/icon-subset.ts` intersects all
string literals with the official glyph list because dynamic icon names cannot
be found reliably from `<Icon>` call sites alone. Change its output from a Google
Fonts URL to the locally generated subset and update `icon-subset.test.ts` to
verify both glyph coverage and the vendored asset.

Problem-authored media is package data, not build data. The package protocol
extracts image references from statements, choices, and official solutions,
including `[asy=<url>]`, `[img]`, and markdown images. The browser downloads
them into a revision-scoped staging CacheStorage cache and commits the package
only when every required image is present. When assembling an offline problem,
the offline rendering adapter rewrites each known media reference to
`/_offline/media?revision=<packageRevision>&url=<encoded-original-url>`.
The service worker opens only that revision's cache and matches the decoded
original URL; it never scans arbitrary revision caches, which could return stale
bytes for a reused URL. This is deterministic across worker restarts and lets
two tabs open different packages without shared mutable routing state. A failed media
fetch leaves the previous ready revision untouched; orphaned staging caches are
removed on startup after consulting IndexedDB.

This self-hosting slice is independently shippable and should land first.

The vendored output is generated, not committed (`static/fonts/` and
`static/vendor/` are gitignored). `scripts/vendor-assets.ts` produces it, and
both `prepare` and `build` run it with `--if-missing`; the build fails rather
than shipping a bundle whose problems render without math, icons, or the
intended typography. Any CI or deploy pipeline that does not run `bun install`
before `bun run build` must call `bun run vendor:assets` itself.

---

## 5. Scope packages and bulk materialization

### 5a. The SQL resolver remains authoritative

A download scope uses the same shape and semantics as a goal:

```ts
type OfflineScope = {
    topic: string[];
    seriesIds: string[];
    seriesScopes: Record<string, { divisions: string[]; formats: string[] }>;
};
```

Membership must flow through
`public.goal_scope_canonicals(p_scope jsonb)`. It is placement-aware: a
canonical may enter the scope through an alias placement under another test.
Filtering canonical rows directly by their own test metadata is not equivalent.

`yearRange` is accepted by the SQL function but no current goal/practice editor
authors it. Do not advertise a year filter in offline v1 until the shared scope
UI and practice contract both own it.

### 5b. A package contains an explicitly bounded membership, not a hidden draw

The existing New draw:

- rereads `problem_progress` on every call;
- grows an uncapped `id.in.(...)` URL exclusion list;
- applies an adaptive band around one rating;
- does not consume the canonical-id set returned by
  `goal_scope_canonicals`.

Calling it repeatedly is therefore slow, does not make the resolver the actual
membership boundary, and produces a queue rather than the reusable local query
source the product requires.

Add a paginated materialization endpoint backed by narrow RPCs that:

1. calls `goal_scope_canonicals`;
2. deterministically selects up to the user-visible requested problem amount
   from the canonicals reached by the scope, without applying a practice mode's
   seen/gradeable/mastery/engagement filters;
3. joins canonical problem content, answer and solution metadata, and every
   matching placement needed for local series/division/format/test queries;
4. returns current overall problem ratings and the user's frozen progress,
   mastery, and engagement for those canonicals;
5. returns the frozen player rating and the server sessions needed by the first
   supported offline workflow;
6. returns stable pages/cursors, total counts, byte estimates, content revision,
   and package revision;
7. enforces the explicit requested amount and hard server-side row, page, and
   payload limits without adding a hidden truncation during paging;
8. creates the package checkout and, for the first shipping slice, its dedicated
   `practice_sessions` row in the same online workflow.

The endpoint derives `userId` from the authenticated request. It never accepts
an arbitrary owner from the body.

Materialization is a retryable two-phase server workflow. One database function
resolves the scope and atomically stores immutable normalized page records under
a `materializing` checkout. The SvelteKit endpoint reads those stored logical
records, computes their RFC 8785 checksums with the same shared TypeScript
canonicalizer the browser uses, and calls a narrow finalize function that stores
all page checksums and changes the checkout to `issued`. No page is downloadable
before finalize, and retrying the same `requestId` resumes or returns the same
finished materialization. This preserves one database snapshot without requiring
PostgreSQL's JSON text formatting to impersonate RFC 8785.

This endpoint materializes bounded scope membership and facts; it does not
reproduce any trainer mode or ordering. The browser defaults the download amount
to 20 and discloses it before creation. That amount limits only the local package,
not the online practice session. If the requested package exceeds a
product/storage hard limit, the download must explain the size and ask the user
to lower the amount or narrow the filters. It must never add an undisclosed cap
and present that result as the requested package.

### 5c. Package shape and atomic installation

Do not reduce a package to `ProblemRow[]`. A reusable local query source needs
normalized entities and explicit membership:

```ts
type OfflinePackageManifest = {
    id: string;
    userId: string;
    scope: OfflineScope;
    contentRevision: string;
    packageRevision: string;
    requestId: string;
    personalStateAt: string;
    downloadedAt: string;
    checkoutId: string;
    problemCount: number;
    placementCount: number;
    assetCount: number;
    byteCount: number;
    state: "staging" | "ready" | "stale";
};
```

The IndexedDB schema should contain stores equivalent to:

- `packages` and `packageMembership`;
- `problems` keyed by canonical id/content revision;
- `placements` keyed by placement id with canonical/test/series coordinates;
- `ratings` and `personalState` keyed by user/canonical;
- `sessions`, `localSubmissions`, `organizationOverrides`, and `outbox`.

Raw `CANONICAL_STATE_SELECT` embeds still pass through `normalizeEmbeds` before
they feed a UI `ProblemRow`, but the durable package keeps normalized placement
and personal-state records rather than embedding mutable state into copied
problem objects.

A download installs into a staging package. Each page is validated and written
transactionally. Only after every page, count, revision, and checksum agrees is
the package marked `ready`. A failed refresh leaves the previous ready package
intact.

`packageId` is the stable local identity shown to the user. Each initial
download or refresh has a fresh `requestId` (its idempotency key) and receives a
new immutable `checkoutId`/`packageRevision`. Pending operations retain the
checkout under which they were created, so refreshing a package cannot rewrite
or invalidate unsynced work from its previous revision.

The package manifest also includes:

- schema version and app build compatibility version;
- user id, scope, and any pre-created server session ids;
- server `downloadedAt` and `checkoutId`;
- frozen player rating;
- problem/placement counts, byte count, and page/checksum metadata;
- last successful sync time and outbox count.

Package creation also returns the frozen player rating and dedicated session as
`baseState`. `beginPackage` stages that snapshot with the revision, and
`commitPackage` promotes the package, personal state, rating state, and session
snapshot in one IndexedDB transaction. The already-landed fixture helper writes
the session snapshot immediately after commit; folding that write into the
staged commit is a small slice-5 integration change required before real network
downloads, not a redesign of the repository.

Cache freshness is five days. Staleness warns and prevents automatic refresh; it
never blocks opening an existing package and never deletes pending work.

### 5d. Refresh and overlapping packages

Refreshing a package first syncs or preserves its pending overlay, resolves the
scope again, downloads changed/added records into staging, updates membership,
and atomically swaps the ready revision. Removing a membership never deletes a
canonical record still referenced by another ready package.

Personal base state is shared per user/canonical, not copied per package. A
successful sync or online refresh can therefore update effective progress in
every overlapping package at once.

---

## 6. Offline trainer behavior

The normal Practice route needs a domain-level data-source seam, not a fake
Supabase client.
The fluent PostgREST query builder is not a useful interface for IndexedDB.

Define a query contract plus explicit entity/write operations, for example:

- `queryProblems(query: PracticeQuery)`;
- `getProblem(problemId)`;
- `getEffectiveProgress(problemId)`;
- `getPlayerRating()`;
- `loadSession()`;
- `recordSubmission()`;
- `setMastery()`;
- `setEngagement()`;
- `setCurrentProblem()`;
- `finishSession()`.

The online implementation delegates to the existing library/session functions;
the offline implementation reads/writes one IndexedDB transaction. The route
selects one source before mounting the shared trainer and keeps it stable for
that mount. Components must not scatter `if (offline)` around individual
Supabase calls, and connectivity changes must not silently switch sources.

### 6a. Local queries may narrow, never expand

The package membership set is the outer authorization/data boundary. A local
query can filter that set by:

- topic, series, division, format, and eventually year;
- answer, solution, verified, and computational attributes;
- manual/adaptive rating range;
- seen/solved/skipped/review status;
- mastery and engagement;
- current-session exclusions and ordering.

A query that asks for data outside every ready package returns an explicit
`not_downloaded` result. It never silently goes to the network while the app is
in an offline session.

IndexedDB indexes should retrieve a reasonably small candidate set; a pure
TypeScript query layer applies remaining compound predicates, canonical collapse,
sorting, and seeded random selection. Candidate semantics live in shared pure
functions wherever possible so online and offline repositories can be contract
tested against the same fixture dataset.

If measured whole-scope sizes make IndexedDB candidate filtering inadequate,
the repository boundary permits moving the local implementation to SQLite/WASM
in OPFS. Do not accept that added asset, migration, browser-compatibility, and
worker complexity without measurements; defined scopes are expected to fit the
simpler IndexedDB design.

### 6b. Snapshot plus overlay equals effective state

The downloaded personal state is a frozen base. Every local query reads the
effective state formed by applying pending operations over that base:

```text
downloaded server snapshot
          +
pending local submissions and organization changes
          =
effective offline state
```

Recording a submission atomically appends local history/outbox data and updates
the overlay used by later queries. New mode must immediately exclude that
problem; skipped/list filters must see local outcomes when those modes ship; and
mastery/engagement changes must be visible across every package containing the
canonical. Optimistic derived state is provisional and is replaced by refreshed
server truth after sync.

### 6c. New mode is the first offline query consumer

For the first shipping slice, `queryProblems` applies New-mode predicates to the
complete package and chooses one result:

- Adaptive off: follow the stored seeded order.
- Adaptive on: choose among locally indexed candidates near a shadow player
  rating, with seeded tie-breaking so equal candidates do not collapse to id
  order.
- Never display or sync the shadow rating.
- Problems with no rating remain eligible through the existing fallback
  semantics.

Update the shadow through the existing `glickoMatchPreview` only:

```ts
shadow += correct ? preview.deltaWin : preview.deltaLoss;
```

This is approximate selection state, not a client rating. It resets after a
successful sync; server ratings remain the only truth.

The full Practice presentation may be shared before every mode is enabled.
Capability checks must disable unsupported modes explicitly. Later modes reuse
the same package/query/overlay foundation. Review requires an
explicit policy for provisional local scheduling; Test requires complete ordered
placement sets and atomic batch sync; neither requires a new local database.

### 6d. Network touchpoints

| Current touchpoint | V1 offline behavior |
|---|---|
| `fetchProblemRating` | read frozen rating from shared local rating state |
| `refreshPlayerRating` | do not call; show the downloaded rating as offline/stale |
| session settings/current problem | update the local session snapshot |
| `recordSubmission` | append one idempotent outbox operation transactionally with local history/counters |
| automatic mastery | append/update a mastery operation after the submission |
| older server history | unavailable; Back is limited to this local run |
| `endSession` | append a session-finish operation after prior session operations |
| Coach work thread | disabled with an explicit offline explanation in v1 |

`/offline` manages and launches packages; it is not the long-term trainer
surface. An explicit package launch opens `/practice` with package identity in
the route. That route must have a credential-free offline boot path and restore
the bound package/session from IndexedDB without caching personalized SSR data.

The overloaded `choices` rule does not change offline. Every rendering/context
path gates options through `isMultipleChoice()`. A free-response answer key is
never rendered as option A, and `test-locked` context withholding remains
structural if Coach support is added later.

---

## 7. Time semantics: occurrence is not rating order

The original design backdated `submissions.created_at` at flush. That cannot
pass safely through the current live triggers:

- `set_submission_encounter` reads the newest existing row, so a backdated insert
  can produce a negative delta and wrong encounter/attempt;
- `handle_submission_rating` applies the old event to already-current rating
  state and then moves `last_match_at` backwards;
- `handle_new_submission` can move progress timestamps and schedules backwards;
- repairing one user's progress does not repair shared problem ratings.

V1 therefore uses two clocks:

- `created_at`: server receipt time and authoritative trigger/replay order;
- `occurred_at`: nullable client occurrence time for display/audit only.

For online submissions, both are effectively now. For offline submissions, the
sync endpoint supplies a bounded `occurred_at` but leaves `created_at` to the
database. Ratings, encounter annotations, progress folding, SM-2 scheduling,
and session aggregates continue to use `created_at` in v1. A long trip therefore
delays the next-review schedule by roughly the offline duration. That is an
explicit fidelity tradeoff in exchange for live ≡ replay determinism and no
global rebuild on every reconnect.

### 7a. Durable local ordering

`performance.now()` alone is not durable: it resets across reloads, browser
restarts, and different tabs. Each local event stores:

- a monotonically increasing outbox `sequence` allocated in IndexedDB;
- a `runtimeId` and monotonic offset within that runtime;
- device wall time for user-facing occurrence display;
- the server-issued `checkoutId` and `downloadedAt` bound.

At sync, the server clamps `occurred_at` to the interval from the server-issued
download time through the sync receipt time and preserves `sequence` as the
stable order. Exact spacing is promised only within one runtime segment;
cross-restart wall time is best-effort. Timezone changes do not alter Unix time,
but manual clock changes can, which is why the server clamp is required.

### 7b. Why New-only matters

New mode excludes prior factual activity and consumes every downloaded canonical
at most once. Consequently the offline block does not need to reconstruct two
separate sittings for the same `(user, problem)` pair. The receipt-time encounter
trigger creates a fresh encounter and the deterministic rating fold remains
valid.

List/review modes can repeat an already-seen problem. Supporting them requires a
settled encounter-boundary representation and replay contract; they remain out
of v1 rather than receiving subtly wrong annotations.

---

## 8. Outbox and sync protocol

The outbox is a typed operation log, not a queue of arbitrary HTTP requests.

```ts
type OfflineOperation = {
    id: string;              // client UUID / idempotency key
    userId: string;
    checkoutId: string;
    sessionId: number;
    sequence: number;
    occurredAt: string;
    type: "submission" | "mastery" | "engagement" | "session-finish";
    dependsOn: string[];
    payload: unknown;
    state: "pending" | "syncing" | "failed";
};
```

### 8a. Required database surface

The declarative schema needs:

- nullable `submissions.client_key uuid` plus a unique partial index on
  `(user_id, client_key)`;
- nullable `submissions.occurred_at timestamptz` for bounded display/audit time;
- an `offline_checkouts` table (or equivalently named package-checkout table)
  carrying checkout id, user, device, package scope/revision, optional
  pre-created session, download/sync/completion timestamps, and lifecycle state;
- transient `offline_package_pages` rows containing the exact materialized JSON
  and checksum for each page, so retries cannot observe content/progress changes
  behind the same revision; finalize deletes them and unfinished rows expire
  after seven days;
- a singleton catalog revision advanced by every successful content sync,
  including deletions;
- a complete-scope materialization function that calls
  `goal_scope_canonicals`, pages stable normalized facts, and cannot be used to
  read another user's personal state;
- a closed, versioned transactional sync function returning operation
  acknowledgements and `client_key -> submission_id` mappings.

Schema changes are made in `supabase/schemas/`, followed through the Supabase CLI
diff/migration flow, and then regenerate
`src/lib/types/database.types.ts`. Do not hand-edit the generated types. RLS and
grants must make checkouts owner-readable while keeping sync-derived writes
behind the narrow function/endpoint; neither function accepts an arbitrary
effective user from the client.

### 8b. Application protocol

Rules:

- Creating a local history entry, updating consumed ids/counters, and appending
  its submission operation is one IndexedDB transaction.
- Submission operations carry every raw field currently sent by
  `recordSubmission`, including answer text and `tries_used`.
- The sync endpoint authenticates the request, derives the user id, validates
  checkout/session ownership, bounds batch and field sizes, and rejects a mixed
  user batch.
- A database RPC applies one ordered batch transactionally. Submission inserts
  use the idempotency key and return `client_key -> submission_id` mappings.
- Mastery/engagement writes run after their dependencies. Session finish runs
  last.
- The endpoint returns acknowledged operation ids and authoritative session
  counters. Only acknowledged entries are removed locally.
- A retry of an interrupted batch is safe. An unknown outcome is retried, never
  guessed successful.

Do not expose a general service-role write endpoint. The accepted operation
union and allowed columns are closed and versioned.

Sync runs in a foreground authenticated page. Acquire a Web Lock keyed by user
id (with a BroadcastChannel fallback/status channel) so two tabs do not flush
the same outbox concurrently. Service-worker Background Sync is deferred: it
cannot safely assume a refreshed Supabase session and is not consistently
available across target browsers.

---

## 9. Multi-device and account conflicts

The download endpoint creates an advisory checkout record containing user,
device id, checkout id, package scope/revision, optional pre-created session ids,
and timestamps. Other devices may warn that offline work is outstanding, but
this is not a lock.

For New mode, online activity on another device can consume a problem after it
was downloaded. The offline submission is still valid work and syncs in receipt
order. It may no longer be the user's first encounter by then; the database
truth wins. The response reports such overlaps so the UI can say that server
progress changed while this device was away.

Account rules:

- an outbox flush requires `auth.uid()` to equal every operation's `userId`;
- signing into another account hides the prior account's download and outbox;
- logout clears the active offline-user pointer and evicts synced snapshots;
- pending work is not silently deleted on logout; it can be discarded only by
  an explicit destructive action naming the affected session/count;
- replacing or refreshing a download never deletes unacknowledged operations.

An `issued` or `ready` checkout remains sync-valid while its installed revision
can still create work; it does not expire merely because time passed or one
outbox became empty. After a refresh or deletion, the client may close the old
checkout only when that revision is no longer active and no local operation
references it. Closed rows are retained for 30 days. Explicit discard marks a
checkout abandoned and retains it for audit for 90 days. Only unfinished
materializations expire automatically (after seven days). This matches the
stronger rule that stale packages remain usable and pending work is never made
unsyncable by retention cleanup.

---

## 10. Coach is a later slice

A local Ollama/vLLM connection can stream without the internet because BYOK
requests go directly from the browser. The current Coach still cannot initialize
fully offline: `#loadBootstrap()` awaits `/api/ai/bootstrap` and the local catalog
together, so a failed server response discards the successful local catalog.

Offline Coach support therefore needs its own design:

- a local-only bootstrap using browser credentials and cached non-secret
  preferences;
- no server-owned provider or tool claims while offline;
- durable conversation/message operations with their existing browser UUIDs;
- work-anchor conflict handling on reconnect;
- dependency mapping from a local conclusion key to the synced submission id;
- preservation of context snapshots and the `test-locked` answer boundary.

Until those exist, the offline trainer hides/disables Coach with an explicit
message. Best-effort fetch failure is not persistence: without an outbox, the
finished transcript is lost on reload.

---

## 11. Verification gates

### Before shell work

- Move the authenticated root server/universal load behavior into `(app)`, keep
  the root layout presentation-only, and prerender `/offline` outside `(app)` as
  specified in the contracts document. Give `(splash)` its own anonymous
  Supabase client for the public welcome count; it must not inherit app auth
  data merely because the old root client did both jobs.
- Add Playwright with Chromium and WebKit projects. The v1 release gate is
  Chromium 111+ and Safari/iOS 16.4+; Firefox 114+ is best-effort and embedded
  Kindle/E-Ink browsers are unsupported.
- Obtain explicit authorization before running `bun run build`, preview, or dev,
  per repository policy.

The browser suite must cover first install, update activation, offline deep-link
navigation, reload while offline, missing download, logout, account switch, and
returning online. It must assert that CacheStorage contains no token-bearing
layout/API response.

### Data/store correctness and pre-release measurements

- Implement the versioned IndexedDB schema, migrations, explicit quota failure,
  and atomic write tests against the contracts document.
- Validate the provisional limits (10,000 canonicals, 50 MiB JSON, 250 MiB with
  media, 250 problems/page) and tune them only if corpus/device measurements
  justify it.
- Contract-test the local query repository against shared fixtures for every
  predicate used by the first shipping mode.
- Test overlapping package membership, staged refresh failure, and reference-safe
  eviction.

The fixture-backed correctness work above has landed. Representative and
worst-case scope sizes, target-browser quota behavior, and query latency remain
pre-release validation inputs for the provisional limits; they no longer read as
unmet prerequisites to the repository work that already exists.

### Before sync work

- Add SQL tests for idempotent retry, ordered application, ownership rejection,
  canonicalization, duplicate client keys, dependency failure, and transaction
  rollback.
- Prove live ratings equal `recompute_ratings()` after an offline batch, because
  both now use receipt-order `created_at`.
- Test browser restart, repeated reconnect events, two flushing tabs, expired
  auth, account switch, a newer online submission, and partial/unknown responses.
- Implement checkout retention (issued/ready while locally usable, 30 days after
  an outbox-empty client close, 90 days after explicit discard, and seven days
  for unfinished materialization) and structured
  server logs keyed by checkout, batch, and operation id. Logs contain
  codes/counts/timing, never answer text.

Every code slice still clears `bun run check` and `bun test`. Every changed
Svelte file also goes through the required Svelte MCP autofixer. The production
browser suite is an additional gate, not a replacement.

---

## 12. Build order and state

| # | Slice | State | Exit condition |
|---|---|---|---|
| 0 | Revise design and settle v1 boundary | **complete** | this document reflects code-path review |
| 1 | Self-host KaTeX and Material Symbols; update subset script/tests | **complete** | no critical CDN request; subset test passes |
| 2 | Production browser harness + credential-free `/offline` route/load relocation | **complete** | offline reload/account tests pass |
| 3 | Minimal service worker for versioned assets and navigation fallback | **complete** | no personalized response enters CacheStorage |
| 4 | Versioned normalized IndexedDB repository, package membership, shared personal state, and connectivity state | **complete** | migration/quota/atomicity/overlap tests pass |
| 5 | Complete paginated scope materialization, staged package install/refresh, dedicated first-slice session, and download UI | **complete** | resolver-contract, completeness, revision, limit, and payload tests pass |
| 6 | Local `PracticeQuery` engine + snapshot overlay + source seam/shadow selection | **data layer complete; standalone presentation transitional** | repository contract and current lifecycle component tests pass |
| 6a | Fold offline New mode into the normal `/practice` route/UI and remove the duplicate trainer | **planned** | neutral offline Practice reload, parity, and no-fallback browser tests pass |
| 7 | Typed outbox schema + sync RPC/endpoint | **complete (client contract + SQL/RPC/endpoint)** | SQL idempotency and live≡replay tests pass |
| 8 | Foreground sync coordinator, auth recovery, multi-tab lock | **complete** | reconnect/account/concurrency browser tests pass |
| 9 | Advisory checkout and conflict reporting | **folded into 5, 7, and 8; no independent slice** | checkout provenance, overlap response, and UI disclosure ship with their owning paths |
| 10 | List/skipped/mixed/test/review consumers or local Coach expansion | deferred | each requires its remaining mode-specific policy and tests, not a new package store |

### What the landed slices do and do not cover

Slices 1–5, 7, and 8 are complete as specified. Session 2 supplied the browser
halves of slices 5 and 8:

- **Slice 5.** `beginPackage` / `stagePackagePage` / `commitPackage` /
  `abortStagingPackage` are implemented with staged-revision isolation, checksum
  and count verification, revision-scoped media staging, and refresh that keeps
  the previous ready revision until commit. The server now provides the
  `goal_scope_canonicals`-backed two-phase materializer, the
  `offline_checkouts` / `offline_package_pages` tables, RFC 8785 checksum
  finalization, and the creation/page/lifecycle endpoints. The browser client now
  drives the full API, performs quota/persistence checks, stages and commits all
  pages, recovers lifecycle calls, and exposes confirmation/progress, refresh,
  cancel, and guarded deletion. `baseState` promotes in the same IndexedDB
  transaction as the revision, and media resolves only through the addressed
  revision cache.
- **Slice 6.** The `PracticeQueryV1` engine (placement-aware scope, New-mode
  eligibility, seeded and nearest-rating ordering, `not_downloaded` vs.
  `exhausted`) and the snapshot-plus-overlay state are implemented and contract
  tested. `TrainerDataSource` now supplies the single online/offline domain seam.
  As a transitional presentation, `/offline` opens the dedicated session,
  resumes its current problem, grades
  and records New-mode answers/skips, shares mastery/engagement overrides, limits
  Back to the local run, and disables Coach/network links with an explanation.
  Adaptive selection uses a seeded tie-break and a runtime-only shadow advanced
  exclusively by `glickoMatchPreview`; successful authoritative sync resets it.
  Slice 6a will bind that source once in the normal Practice route, make the
  route safely reloadable from a neutral shell, and remove the duplicate
  trainer. The migration is specified in
  [`offline-practice-route-migration.md`](./offline-practice-route-migration.md).
- **Slice 7.** The typed outbox, its coalescing rules, ordering, failure
  handling, and `acknowledgeSync` are implemented against the wire contract.
  `submissions.client_key` / `occurred_at`, the closed transactional sync RPC,
  operation ledger, overlap reporting, and authenticated endpoint have landed.
  The foreground coordinator groups operations by immutable checkout provenance,
  serializes tabs with Web Locks (and a BroadcastChannel-coordinated fallback),
  retries transient failures, resumes after reload/token refresh, and discloses
  account/auth and overlap states without dropping the outbox.

Where things live: `src/lib/offline/` (contracts, parsers, checksums, schema,
storage backends, repository, query engine, overlay, media, fixtures),
`src/service-worker.ts`, `src/routes/offline/`, `scripts/vendor-assets.ts`, and
the Playwright harness in `playwright.config.ts` / `e2e/`.

No UI for a later slice should ship ahead of its persistence and recovery path.
In particular, do not offer “Download” until a browser can reload the session
offline and retain a submission across a failed, retried sync.

### Remaining delivery sessions

The remaining numbered slices are dependency labels, not separate work
sessions. Finish v1 through these delivery stages:

1. **Server spine — complete:** the server halves of 5 and 7 plus checkout
   provenance and overlap reporting from 9 — schema, two-phase materialization,
   endpoints, transactional sync, migrations/types, and SQL tests.
2. **Download and recovery — complete:** atomic base-state promotion, revision-addressed
   media routing, the download UI/orchestrator from 5, and foreground auth,
   locking, retry, and conflict disclosure from 8.
3. **Trainer integration and release proof — refactor pending:**
   the trainer seam and New-mode consumer from 6 are implemented in a
   transitional surface. Fold them into the normal Practice route per
   [`offline-practice-route-migration.md`](./offline-practice-route-migration.md),
   then run the full 14-step browser acceptance scenario in
   `e2e/offline-acceptance.e2e.ts`.
   Chromium/WebKit execution and the external/device/database measurements in
   §13 remain the release gate.

---

## 13. Measurements still required

### 2026-08-13 local baseline

`bun scripts/offline-measurements.ts` now makes the repeatable query/payload
baseline explicit. On the current Apple Silicon development host:

| Candidate set | Unfiltered p50 / p95 | Compound filters p50 / p95 |
|---:|---:|---:|
| 100 | 0.016 / 0.061 ms | 0.007 / 0.011 ms |
| 1,000 | 0.189 / 0.328 ms | 0.027 / 0.030 ms |
| 10,000 | 8.757 / 9.256 ms | 0.253 / 0.411 ms |

The checksum-correct Geometry/AMC fixture is 4 canonicals, 5 placements, and
5,401 bytes of page JSON. Vendored render assets occupy 1,552 KiB under
`static/fonts` and 592 KiB under `static/vendor/katex` (46 files total). These
are regression baselines, not substitutes for corpus and target-device results.

The following release measurements still require the production corpus, a
running Supabase stack, or physical target devices and could not be fabricated
from the fixture environment:

- Payload size and problem/placement count for representative narrow, medium,
  and whole-catalog scopes after canonical collapse.
- Candidate counts and query latency for representative combinations of topic,
  series, rating, answer, progress, mastery, and engagement filters.
- Storage duplication avoided by shared records across overlapping packages.
- IndexedDB quota behavior on target Safari/iOS and Chromium browsers.
- Material Symbols and KaTeX self-hosted transfer/storage sizes.
- Sync transaction time for 25, 100, and maximum-size operation batches.
- Current global `recompute_ratings()` runtime as a diagnostic benchmark, even
  though v1 sync no longer requires running it.

These measurements validate or tune package limits, determine index choices,
and show whether the IndexedDB query implementation remains sufficient. The shell/auth,
receipt-order timestamp, complete-scope materialization, repository boundary,
and typed-outbox decisions do not depend on their exact values.
