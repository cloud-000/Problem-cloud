# Offline-Resilient Pages

> [!NOTE]
> This document describes the implemented offline-resilient direction. Three
> pieces have different costs:
> they have very different costs: **offline-resilient presentation** (§3–§5, §8),
> which shows a real page frame instead of the browser's error page; **local
> reads** (§6), which serve catalog queries from the problems already downloaded
> into IndexedDB; and an **explicit offline mode** (§7) the user can see and set.
> Only §6 extends the shipped data contract, and only in the part §6c names; §12
> is how its filters are kept honest.
> Normal local Practice treats all ready downloaded packages as one catalog;
> package identity remains hidden checkout provenance for writes and sync. The
> contracts themselves stay in [`offline.md`](./offline.md) and
> [`offline-contracts.md`](./offline-contracts.md); where this document restates
> one, those files win.

## 1. Goal

When the app cannot reach the network, a direct navigation or reload should not
fall through to the browser's connection-error page. The requested page should
boot the normal ProblemCloud frame—shared navigation, page title, and stable
controls—and then show the best thing it can:

- **data it already has locally**, where a downloaded package can answer the
  page's query (§6); or
- **the failed dependency, stated inside the UI**, for every page whose data
  only the server holds.

A page whose data is served locally must say so. "Showing your 240 downloaded
problems" is a different claim from "Library," and the difference is the whole
honesty budget of this feature.

## 2. Product boundary

- `/offline` is the authenticated package manager in `(app)`. The internal
  `/offline-shell` route is the credential-free recovery document cached by the
  service worker; both render the same local presentation.
- Downloaded Practice verifies one local account and at least one ready package.
  A normal local-mode `/practice` session draws from their union. An explicit
  `/practice?offlinePackage=<packageId>` remains a legacy compatibility route.
- An ordinary online Practice session that loses connectivity reports an
  offline/retry state. It never changes to a downloaded source implicitly.
- **Catalog reads may be served from the local package** under §6, labeled as the
  downloaded subset, wherever they route through the read seam of §6a.
- Writes, Coach answers, sync-dependent views, and anything not backed by a
  package remain unavailable until separately specified and implemented.
- A local account marker may help locate downloaded packages. It is not an
  authenticated server session and must not authorize or populate other pages.

### 2a. Why a catalog read may fall back when Practice may not

`offline-practice-route-migration.md` §1.5 forbids connectivity from selecting a
source. That rule is about **bound, writable sessions**: a Practice source owns a
session id, grades answers, writes an outbox, and syncs. Falling back silently
would file work against the wrong session and make the outbox's provenance a
function of the Wi-Fi.

A catalog read binds nothing. `src/routes/(app)/library/` performs no `insert`,
`update`, `upsert`, or `delete` — it is a read-only browse surface, and so are
the other consumers in §6a. An implicit read fallback is admissible there
precisely because nothing about it is recoverable state, and the rule it appears
to violate was never about reads.

Two conditions make that safe, and both are load-bearing:

1. **The source is named in the UI** (§7), not inferred by the user from a short
   list.
2. **No local read is presented as a catalog fact.** Counts, "no results", and
   pagination ends describe the downloaded set, never the library.

## 3. Target navigation behavior

On an online navigation, SvelteKit continues to serve and hydrate the normal
route. On a failed document navigation under the app route group:

1. The service worker returns a build-owned, credential-free application entry.
2. The entry boots the shared layout and determines the requested pathname.
3. The requested presentation mounts without assuming that auth or route data
   was embedded in the document.
4. Its data source resolves locally (§6) or reports the offline state.
5. An unanswerable dependency becomes a typed page state rendered inside the UI.
6. Retry reruns the same source; it does not select a different source.

The address bar should retain the requested URL. A failed `/library` navigation
should look like Library restricted to downloads, not redirect to a fictitious
local Library and not silently become `/offline`.

### 3a. Retaining the URL is a consequence, not a setting

Keeping the requested URL in the address bar is downstream of §8, not
independent of it. The shipped worker deliberately does the opposite:
`bootFallback` in `src/service-worker.ts` rewrites the URL to the cached
document's own path, because the CSR router reads `location` at startup and
would otherwise immediately try to boot the requested route — which offline
fails in the loads, producing an error page instead of a frame.

So a fallback document can carry the requested URL only once that route can
actually boot without its server data. Until then the honest options are the
current rewrite, or the pattern `/offline-shell` uses: boot at
the cached document's path, then `history.replaceState` the requested URL back
after the page has bound its local state. The worker already passes the original
URL to the document as `__pcOfflineRequestedUrl`, so the second option needs no
new plumbing — see §11 step 1.

That pattern has one cost to gate: after the rewrite, the router's internal
notion of the current URL differs from the address bar, so a link click or
`goto()` from that state resolves against a stale base.

Explicit downloaded Practice navigation keeps its existing, more specific
neutral Practice boot. Generic navigation must never invent an offline package
identity.

## 4. Application-shell constraints

These constraints are already specified by [`offline.md`](./offline.md) §3a–3b,
enforced by `isPrivate()` and the `PRECACHE` allowlist in
`src/service-worker.ts`, and fenced by `e2e/offline-shell.e2e.ts` ("caches no
personalized or credentialed response"). They are restated here only as the
boundary this proposal must not widen; the contract itself stays in those files,
and any change belongs there rather than in this document.

The fallback entry may contain only build-owned resources and non-personalized
presentation state. It may precache:

- the neutral entry document;
- versioned JavaScript and CSS needed to boot the frame — already satisfied:
  `PRECACHE` spreads all of `build`, so every route chunk is present offline;
- vendored fonts, icons, KaTeX, and other build-owned static assets.

It must not cache or synthesize:

- authenticated SSR documents or personalized page HTML;
- SvelteKit `__data.json` responses;
- cookies, access tokens, refresh tokens, claims, or profile payloads;
- Supabase/API responses merely because they were successful GET requests; or
- answer-bearing or user-specific data outside an explicit offline package.

There is deliberately no "non-personalized static metadata" allowance. Content
that is user-invariant is not thereby safe — the series and test catalog is both
user-invariant and answer-adjacent, and a clause worded that loosely reads as
permission to cache it. **Anything beyond build output enters through a package,
or not at all**, and §6 follows that rule rather than carving an exception from
it: the catalog metadata offline reads need is added to the package, not to
CacheStorage.

Expanding the fallback route by route grows `PRECACHE`, so the eviction rule is
part of this constraint: `activate` deletes every cache except the current
`pc-assets-<version>` and any `offline-media-*`, which belong to package
revisions rather than to builds and must survive a deployment.

Serving the last successful personalized document is not an acceptable shortcut:
it can expose the wrong account after logout or account switching and makes the
cached document an untracked data store.

## 5. Page data and error-state contract

Network-backed page controllers need explicit states rather than treating a
failed load as a failed application boot:

- `loading`: the page frame is mounted and its dependency is pending;
- `ready`: validated server data is available;
- `local`: the dependency was answered from a downloaded package (§6);
- `offline`: the dependency could not be reached and nothing local answers it;
- `auth-required`: the server rejected or could not validate the session;
- `error`: the server responded, but the request failed for another reason.

`local` is a distinct state from `ready` on purpose. They differ in what the
result means — a subset versus the catalog — and collapsing them is how a local
result silently becomes a catalog claim.

This is a **second axis**, not a replacement for the connectivity state machine
in [`offline.md`](./offline.md) §3c (`online` / `offline` / `auth-required` /
`syncing` / `sync-error`), implemented in `src/lib/offline/connectivity.ts`. That
one describes the application's connection; this one describes one page's
dependency, and two pages can disagree. Where the axes name the same condition
they must use the same word, which is why the session state here is
`auth-required` and not a second spelling of it.

Offline detection should be based on the request result and the effective mode
of §7a, not on `navigator.onLine`. A database outage can occur while the browser
reports online, and `navigator.onLine` can be inaccurate. No component performs
its own connectivity check.

Each page should define:

- what stable presentation can render without data;
- which controls are disabled and why;
- whether Retry is safe and idempotent;
- what happens if connectivity changes during an action; and
- whether any in-memory input should survive retry.

An unsupported offline action should fail before mutation and explain the
requirement. It must not be queued unless that feature has a separately specified
offline write, conflict, and synchronization contract.

## 6. Local reads

Offline reads use the same IndexedDB the trainer uses, through the same
repository seam. This is not a Library feature; Library is the first consumer.

### 6a. Local capability attaches to the read seam, not to a route

Catalog reads against `problems`, `tests`, `series`, `user_problem_index`, and
`problem_ratings` live in six places today:

| Module | Reads | Consumers | Offline candidate? |
|---|---|---|---|
| `src/lib/library.ts` | 11 | `/library`, `/find`, `/goals`, `/progress`, `/practice`, home, problem cards, admin | **yes** — the main seam |
| `src/lib/trainer.ts` | 5 | Practice | already has a local path via `TrainerDataSource` |
| `src/lib/series-review.ts` | 2 | `/progress` review panels | yes, after `library.ts` |
| `src/lib/home.ts` | 2 (`user_problem_index`) | home worklist | yes, after `library.ts` |
| `src/lib/ai/context/resolve.ts` | 3 | Coach context | deferred with Coach (`offline.md` §10) |
| `src/routes/(splash)/welcome/+page.ts` | 5 | public splash | **no** — anonymous, pre-auth, no package |

The rule this table implies is the important part: **a surface gets offline
capability by routing its reads through the seam, not by being individually
ported.** A surface that queries Supabase directly does not inherit it — and the
correct fix there is to move it onto the seam, not to add a second local path.

The seam is smaller than the consumer list suggests. Eighteen call sites use it,
and they divide sharply:

- `fetchAllSeries` — 8 of the 18, feeding the series dropdown on `/goals`,
  `/progress`, `/find`, home, Practice's SessionsView, Library, and `/offline`
  itself. It selects `id, name` only, which is exactly what
  `OfflinePlacementV1.series` carries, so **it is answerable today** and every
  one of those filters works locally without the §6c contract change.
- `fetchProblems` and `fetchByIds(…, "problems", …)` — answerable today (§6b).
- `fetchSeries`, `fetchTests`, `fetchAllTests`, `fetchTestsForSeries`, and
  `fetchByIds` for tests or series — blocked on §6c.

So the dependency is not "Library first, then everyone": problem-level reads and
every series dropdown land together in one slice, and only the Library Tests and
Series *tabs* wait for the package fields.

`home.ts` is the exception that proves the rule. Its worklist reads
`user_problem_index` **directly**, not through the seam, so it inherits nothing —
but its two predicates (`next_review_at` due, `mastery = needs_work`) are both
carried by `personalState.progress`, so it is locally answerable once someone
ports it. Budget it as its own item, not as a consequence of `library.ts`.

Practice is the precedent, not an exception: `TrainerDataSource` is exactly this
seam for trainer reads. What §6 adds is its catalog counterpart.

### 6b. What the package already answers

Every predicate and display field `fetchProblems` uses has a local source today.
No contract change is required for problem-level reads:

| Need (`src/lib/library.ts`) | Local source | Notes |
|---|---|---|
| exact-id search | `canonicalId` | free-text problem search already returns `[]` online (`if (search && !searchIds) return []`), so no local text index is owed |
| `testId` / `seriesId` scope | `placements` (package/test, package/series indexes) | placement-aware, matching `goal_scope_canonicals` semantics |
| `topic` | `problems` (user/content/topic index) | |
| `tags` | `OfflineProblemV1.tags` | TS predicate after the index narrows |
| `difficulty` band | `OfflineProblemRatingV1.rating` | **frozen at package revision**, see §6d |
| `quality`, `verified`, `isComputational` | `OfflineProblemV1` | |
| `mastery` / `engagement` | `personalState` + `organizationOverrides` | the existing snapshot-plus-overlay path |
| card content: statement, choices, topic, tags | `OfflineProblemV1` | |
| card context: test, series, division, format, year, AoPS category, problem number | `OfflinePlacementV1` | |
| ordering `.order("n").order("problem_id")` | `placement.problemNumber`, then `canonicalId` | |

Three rules carry over unchanged and must be honored at the new call sites:
`choices` is read only behind `isMultipleChoice()` (a one-element array **is the
answer key**); nothing casts into a contract type — local records are parsed; and
**every rendered problem passes through `rewriteProblemMedia`**. That last one is
easy to miss because it is currently applied inside the practice assembly path
(`repository.ts:1123`) rather than at the storage boundary, so a browse result
assembled beside it renders every image against its original remote URL and
404s offline. Either the browse assembly calls it too, or the rewrite moves down
to where both paths share it.

### 6c. What the package does not carry

Test- and series-level reads query those tables directly, independently of
problems, and the package holds only the `test`/`series` objects embedded in
`OfflinePlacementV1`. Missing:

- `tests.type` and `tests.is_computational` — both are filters;
- `tests.time_limit_seconds` and the per-test problem count — both are displayed;
- `series.is_official` — a filter;
- any test or series with **zero** downloaded problems, which cannot appear.

Closing this is a contract change, not a UI change: the server materializer, the
record shapes (`offline-contracts.md` §2d), checksum normalization, `parse.ts`,
and an additive IndexedDB version all move together. That is the cost boundary,
and the reason §11 ships problem-level reads first.

Until then those reads report `offline`, naming what is missing rather than
rendering a partial catalog as if it were the catalog.

### 6d. What a local answer means, and how it differs

Four differences are real and must be designed rather than discovered:

1. **Scope.** The result set is the downloaded canonicals, not the catalog. This
   is §2a's labeling condition, and it governs empty states especially: "none of
   your downloaded problems match" is true; "no problems match" is not.
2. **Aliases.** Membership is per-canonical, but the materializer joins
   placements on `i.canonical_id = coalesce(p.canonical_id, p.id)`
   (`supabase/schemas/offline.sql`), so **every** placement of an in-scope
   canonical is downloaded — including placements under tests outside the
   package's scope. A local list therefore emits **one row per downloaded
   placement** and matches online exactly, where AMC 10A #18 and AMC 12A #12 are
   two rows. Collapsing to one row per canonical would be a silently different
   list. Problem *content* is downloaded once, keyed by canonical; the placement
   carries the display context.
3. **Ratings are frozen.** The difficulty band filters on the rating captured at
   the package revision, while online filters on live Glicko. The same band can
   return different sets before and after a sync; say so where the filter lives.
4. **Links leave the local world.** AoPS links on series and test cards are dead
   offline and must be hidden or disabled with a reason. The one in-app launch —
   `practiceLaunchHref()` — is `kind: "mock-test"` and appears only on **test**
   cards, and Test is precisely the mode `offline-practice-route-migration.md`
   keeps disabled until ordered placements and atomic batch submission ship. So
   there is no local target to route it to and none should be invented: offline,
   that button is disabled with the same explanation the trainer already gives.
   This only arises once test-level reads ship (§11 step 8). A local list that
   dead-ends on every click is worse than a stated offline state.

### 6e. One engine, one filter vocabulary, several intents

Unify — but at the layer that is already unified, and not by merging the query
shapes into one.

`src/lib/offline/query.ts` is factored this way today. `placementMatchesScope`,
`candidateMatchesScope`, `matchesAttributes`, `orderCandidates`, `coverageOf`,
and `missingCoverage` are all intent-neutral over a `QueryCandidate`. Exactly two
things are practice-specific: `newModeEligible` (the eligibility predicate) and
`runPracticeQuery` (the entry shape). So the shared core the question is aiming
at exists; what is missing is a second entry beside `runPracticeQuery`.

The recommended shape is one query type with a discriminated intent:

- **shared:** `userId`, `packageIds`, scope (`topic`, `seriesIds`,
  `seriesScopes`), attribute filters, and the local-only guarantees (package-
  bounded candidates, placement-aware scope, `not_downloaded` rather than a
  network request);
- **`intent: "practice-new"`** adds `sessionId`, `excludeCanonicalIds`,
  seeded/nearest-rating ordering, `limit`, and `newModeEligible`;
- **`intent: "browse"`** adds offset pagination and placement ordering, and
  applies **no** eligibility predicate.

Three things must not be unified, and this is the part worth being firm about:

1. **The eligibility predicate stays practice-only.** `newModeEligible` has a
   parity gate against the online eligibility mirror and a live≡replay
   determinism contract behind it. A browse intent that accidentally inherits it
   would hide every attempted problem from Library; a practice intent that loses
   it breaks a release gate.
2. **The result types stay separate.** Practice returns
   `OfflinePracticeProblemV1` (effective progress, frozen rating, session
   exclusions); browse returns rows with placement context and pagination.
3. **The filter vocabulary is extended, not replaced.** Browse needs `tags`,
   `quality`, `testId`, `year`, `type`, and `isOfficial` on top of the practice
   filter set; practice keeps `answerAvailability` / `solutionAvailability`.

`PracticeQueryV1` is a **local** contract, not a wire contract — it never leaves
the browser — so folding it into a shared type is a refactor with parity tests,
not a protocol break. Do it in the same change that adds the browse intent, and
specify it together with the List and Skipped practice members that
`offline-practice-route-migration.md` phase 6 gates. They are one contract
extension; writing the query engine twice is how their semantics diverge.

## 7. Offline mode: indicator and manual switch

Today the app has a connectivity state machine and a banner for *sync* problems,
but nothing tells a user that what they are looking at came from their device,
and nothing lets them ask for that on purpose.

### 7a. One effective mode, derived once

```
effectiveMode = userPreference === "downloaded-only"
    ? "local"
    : isOffline(connectivityState) ? "local" : "online"
```

Every source seam reads this one derived value. No component calls
`navigator.onLine`, and no route re-derives the rule — the same discipline
`offline-contracts.md` already applies to capability checks.

The preference is two-state (`auto` by default, `downloaded-only` when the user
sets it), stored locally with the other settings. It is a device preference, not
account state: it must not sync, and it must survive a reload offline, which
rules out storing it anywhere the server owns.

### 7b. What the switch may not do

The switch is an explicit user act, so it does not violate §2a. It is still
bounded by the rule that a **bound, writable session never changes source under
a mounted UI**:

- toggling during an online Practice session does not convert it to a package
  session — the change applies to the next launch, and the UI says so;
- toggling during a downloaded session does nothing; that session is already
  bound and stays bound (`offline-practice-route-migration.md` §1.5);
- turning the switch **off** while offline does not fabricate a network; it
  restores `auto`, which is still `local` until connectivity returns.

Read surfaces may re-resolve immediately, because §2a's reasoning holds — nothing
is bound and nothing is lost. It must be a visible transition (the source label
changes, the result set may grow), never a silent reshuffle under a scrolled
list.

### 7c. Naming, and what the indicator claims

Only some surfaces have local data, so the control must not promise an offline
app. Prefer **"Use downloaded content only"** over "Offline mode": it is true,
it names the mechanism the user already understands from the package manager,
and it does not invite the reading that Coach or history will work.

The indicator belongs in the app frame as a persistent, low-noise chip — not a
toast per navigation, and not merged into the existing sync banner, which is
about outbox trouble and should stay rare enough to be alarming. One toast on an
actual transition is appropriate; per-request notification is not. The chip is
also the natural place to hang the switch, so the state and its control are the
same object.

The per-page `local` / `offline` states of §5 remain necessary. The chip says
what the app is doing; only the page can say whether *this* result came from the
package, and a downloaded-only user browsing a series they never downloaded must
still see `not_downloaded` rather than an empty list.

## 8. SvelteKit implications

The current authenticated route tree cannot depend exclusively on server-rendered
HTML and server `load` data if its frame must boot during a direct offline reload.
Implementation should separate:

- a credential-free, build-owned presentation bootstrap;
- online auth validation and personalized layout data; and
- route-specific data loading with visible failure states.

### 8a. The frame cannot live under `(app)`

The blocking constraint is `src/routes/(app)/+layout.server.ts`, which returns
session, user, profile, and cookies. Booting *any* `(app)` route in the browser —
offline hydration or a client-side navigation — fetches that layout's
`__data.json`, and offline that request fails. SvelteKit routes a failed `load`
to the nearest error boundary **above** it, so a failed `(app)` layout load
renders at the root boundary: the frame this proposal wants to show is precisely
the thing that cannot render. No `(app)/+error.svelte` can rescue it, and there
are no error boundaries in the tree today at all.

That leaves two options, and this proposal takes the second:

1. Remove the server load from `(app)` and move session/profile to a client-side
   fetch. This contradicts §10's own gate that authenticated SSR is unchanged,
   and rewrites the three-file auth pattern in `CLAUDE.md`.
2. **Put the neutral frame outside `(app)`** — a prerendered, `ssr = false` route
   that imports the shared layout *components* and picks a presentation. Online
   SSR, `safeGetSession`, and `authGuard` are untouched. This is not a new idea:
   `/offline-shell` is already exactly this. See
   §8c — the right move is to have **one** of them, not a third.

Option 2 is what makes §8 and §10 consistent, and it is why the fallback renders
a *presentation* rather than the real route: offline `/library` shows the Library
presentation from the neutral shell, never the `(app)/library` route itself.

It follows that each supported presentation must be mountable from either side.
`(app)/library/+page.svelte` currently owns the filter state, the fetch calls,
and the store, so it becomes a thin route wrapper over a view component that
takes its data source as a prop — one component, mounted by the `(app)` route
with the Supabase source and by the neutral shell with the local one. That
extraction is most of the per-route work in §11.

### 8d. Offline is the same UI, including the nav

There is no reduced offline chrome. The shell mounts the **same**
`(app)/+layout.svelte` — same sidebar, same nav, same topbar, same components —
because a stripped frame is a second design to build and maintain, and it makes
"offline" feel like a different application when the point is that it is not.

The shell's own markup is therefore near-empty; what it hosts is the real layout.

Identity for the frame comes from the browser Supabase client, which reads the
session from the auth cookie without a network round trip — the practice shell
already constructs that client. This is not a relaxation of §4: nothing is read
from CacheStorage, nothing personalized is written to disk, and the token store
is the one the app already uses. Two limits stay hard:

- **A locally-read session renders UI; it authorizes nothing.** Every real
  request is still validated server-side by `safeGetSession` / `authGuard`. The
  frame showing your name is not a claim that you are signed in — it is a claim
  that this device recently was.
- **Profile-derived detail is not invented.** `meta.activeUser` holds a user id
  only, and the profile row (username, avatar) is server data that must not be
  cached, so those slots render their existing empty state until online.
  Notification badges simply do not load. If a display name offline is wanted
  later, it is added to the local account record deliberately — never recovered
  from a cached response.

**Nav links must work, and this is the one mechanical consequence.** In the shell
the SvelteKit router is booted at the shell's route, so letting a sidebar click
navigate to `(app)/library` would run that layout's server load and fail (§8a).
The shell therefore intercepts navigation — `beforeNavigate`, cancel, swap
presentation, update the URL — and maps the pathname through the same §8b/§8c
declaration it already uses. The sidebar is not modified and knows nothing about
this: it emits ordinary hrefs, exactly as online.

So the UI is identical and the host is invisible. The only thing that differs is
who resolves the URL, and the user cannot see that.

Two costs come with this, and they belong to step 4 rather than to Library:

- **The layout does network work on mount.** `(app)/+layout.svelte` calls
  `fetchUnread(supabase, userId)` with no `.catch` and opens a realtime
  notifications channel. Offline the first is an unhandled rejection and the
  second retries forever. Both need guarding before the layout can be mounted
  from the shell. This is presumably why the practice shell avoided the layout
  and passed `{} as never` for page data.
- **The navigation interception must be verified, not assumed.** `beforeNavigate`
  with `cancel()` is the intended hook, but this is a Svelte 5 codebase and
  `CLAUDE.md` is explicit that router behavior is checked against the docs rather
  than recalled. Confirm before building on it.

### 8b. Navigation policy

The worker already refuses to fabricate documents for `/api/*`, `/auth/*`,
`__data.json`, Supabase origins, and every non-GET request — so form actions and
SvelteKit data requests are covered by the shipped `isPrivate()` denylist. The
delta this proposal asks for is to invert it: an explicit allowlist of app
pathnames that may receive a frame, with every unlisted path — including a route
that ships later and is not added — falling back to the plain recovery
presentation rather than to a frame the app cannot populate.

That list must not be hand-maintained in the worker. The shell already knows
which presentations it can render; export that mapping from one module and have
both the shell and `src/service-worker.ts` import it. A hand-kept copy in the
worker is a list that drifts the first time a route is added.

### 8c. One shell, not three

A "shell" here is **a blank HTML file**. It holds no trainer, no Library, no
duplicate UI — it is a prerendered document with no server data, whose only job
is to be cacheable and then start the app. `/offline-shell` is not a second app;
it boots the shared local presentation without authenticated server data.

Two of these files exist today, and they differ only in what they show after
booting:

| Document | Shows after boot |
|---|---|
| `/offline` | the authenticated package manager |
| `/offline-shell` | the credential-free recovery document |

Adding a third for Library would be the mistake. **The correct end state is one
document.** It reads `__pcOfflineRequestedUrl`, decides which presentation the
requested URL calls for, lazily imports it, and restores the URL. The package
manager stops being a document and becomes one of the presentations, alongside
the trainer, Library, and a plain "not available offline" state.

This is cheap because the presentations are already code-split: every route chunk
is in `build` and therefore already precached (§4), so a lazy import inside the
shell costs one more chunk read from CacheStorage, not a bigger document.

It also deletes logic rather than adding it. The worker currently branches
between two fallback documents; with one shell it returns that document for any
allowlisted navigation and stops needing to know what Practice is. The same
mapping that drives the allowlist (§8b) drives the presentation switch — one
declaration, two consumers.

The migration is ordinary: build the presentation switch in the shared offline
component, render it from `/offline` and `/offline-shell`, then delete
`/offline-practice-shell` and the worker's
branch. Do it **before** Library becomes a presentation, so the third document
never exists.

## 9. Reconnect behavior

Reconnect is a retry opportunity, not a source transition. Pages may retry
automatically when the operation is read-only and bounded, but should still
expose an explicit Retry action. Mutations require their normal idempotency and
error-handling rules.

For Practice specifically:

- online Practice retries its online source and remains the same session;
- downloaded Practice remains bound to its package session even after reconnect;
- foreground sync follows the existing outbox contract; and
- returning online never merges or replaces the mounted source implicitly.

Read surfaces are the deliberate exception, in the safe direction only, under the
visibility rule of §7b. Reconnect does not clear a `downloaded-only` preference:
the user asked for local, and connectivity is not consent.

## 10. Verification gates

A production-browser suite should prove, at minimum:

- direct offline reload of each supported app URL renders the shared frame rather
  than the browser connection-error page;
- the correct route-specific state appears — `local` where a package answers,
  `offline` where none does;
- online restoration and Retry load the intended route without changing source,
  except the stated and visible local→server transition on read surfaces;
- normal online behavior and authenticated SSR remain unchanged;
- ordinary online Practice never falls through to downloaded Practice, **and
  toggling the §7 switch mid-session does not change a mounted session's source**;
- normal downloaded Practice draws across ready packages while each write keeps
  the checkout provenance of the package that supplied its problem;
- the `downloaded-only` preference survives a reload while offline and is never
  written to the server;
- unsupported actions cannot be entered accidentally;
- an offline or local state is visually distinguishable from a legitimately empty
  result — an empty list read as "no problems" is the exact failure this document
  exists to prevent, and it is not caught by asserting that the frame rendered;
- a local read never escapes package membership, never issues a network request,
  and matches the same fixtures run through the online query path;
- an undownloaded scope reports `not_downloaded` rather than an empty catalog;
- the browse intent applies no practice eligibility predicate, and the practice
  intent's eligibility parity gate still passes after unification (§6e);
- a reload paints no personalized detail (username, counts, badges) recovered
  from anywhere but a validated online session; and
- CacheStorage contains no personalized response, auth material, SvelteKit data
  payload, or answer-bearing content outside package caches.

Browser offline emulation must be part of this gate because disabling Wi-Fi does
not make services on `localhost` unreachable. Development testing can stop or
block local Supabase while keeping Vite available to exercise request failures,
but it does not prove direct offline navigation: the production service worker
exists only in a build/preview run. The §7 switch is useful here — it exercises
local sources without emulation — but it is **not** a substitute for that gate,
because it does not prove the document boot path.

## 11. Suggested delivery order

**Scope decision (2026-08-14): steps 1–7 are in scope.** The goal is that offline
mode works — no browser connection-error page, a visible mode, and problem reads
falling back to downloaded content *everywhere the app asks for problems*, not
only in Library. Step 8 (test- and series-level catalog fields) is explicitly
deferred; §6c's reads report `offline` until it ships.

Step 1 stands alone because it delivers most of the presentation value at a
fraction of the cost. Steps 2–3 are cheap and independently useful. Steps 4–7 are
the real work, and they are contract work with a UI at the end.

1. **Route-aware recovery copy, one internal shell.** Keep `/offline-shell` as the returned
   document. Read the requested URL the worker already passes as
   `__pcOfflineRequestedUrl`, name the unreachable area in the copy, keep the
   Downloaded Practice launcher in view, and restore the requested URL per §3a.
   No route-tree changes, no cache-policy changes.
2. **Effective mode and indicator** (§7a, §7c) over the existing connectivity
   state machine — read-only at first: the chip reports, nothing switches.
3. **The `downloaded-only` preference** (§7b), applied to Practice launch
   selection only, where a bound local source already exists.
4. **Collapse the two shell documents into one** (§8c) and drive both its
   presentation switch and the worker's navigation allowlist from one exported
   mapping (§8b). This deletes `/offline-practice-shell` and the worker's
   fallback branch; it is a simplification, and doing it here is what stops
   Library from adding a third document.
5. Extract the Library presentation from its route into a source-agnostic view
   component (§8a), keeping the online route's behavior identical.
6. **Extract the filter spec** (§12b layer 1) so `fetchProblems` and the local
   engine fold one definition, then **unify the query type and add the browse
   intent** (§6e) in `offline-contracts.md` §4, alongside the List and Skipped
   practice members — against the existing package records, problem-level reads
   only. The spec comes first: it is what makes the browse intent provable.
7. Give `library.ts` a local implementation behind the §6a seam, mount it in the
   neutral shell with §2a labeling and §6d link rules, and gate it on §10's
   parity tests. `/find`, `/goals`, `/progress`, and the home worklist inherit it,
   as does every series dropdown (§6a).
8. Extend the package to carry test and series catalog fields (§6c) — server
   materializer, record shapes, checksum, parser, additive schema version — then
   enable test- and series-level reads.

No local surface ships before the query member it depends on is specified and its
parity fixtures pass, for the same reason no offline mode ships ahead of its
persistence path.

Coach, history, and settings stay frame-only until each has its own storage,
authorization, mutation, conflict, and sync design. The public splash
(`(splash)/welcome`) is deliberately never offline-capable: it is anonymous and
pre-auth, so there is no account marker and no package to read.

This proposal does not alter the mode order or contracts in
[`offline-practice-route-migration.md`](./offline-practice-route-migration.md);
§6e's unified query member is the one place the two must be specified together.

## 12. Filter parity, and how it is proven

### 12a. Why browse cannot copy practice's parity strategy

The practice engine does not prove parity by comparing two implementations. It
achieves it by **sharing one**: `newModeEligible` imports `hasComparableAnswer`
from `src/lib/problem-response.ts` and `hasPriorActivity` from
`src/lib/offline/overlay.ts`, and its own comment says the online contract is
"reused rather than restated." There is one definition, used twice.

Browse cannot do that, because its online predicate is not a predicate. It is a
sequence of PostgREST builder mutations inside `fetchProblems` — `.in("topic",…)`,
`.gte("rating",…)`, `.contains("tags",…)`, `.or("mastery.is.null,…")` — and a
query-builder call cannot be evaluated against an in-memory candidate. Sharing is
unavailable, so drift becomes possible for the first time.

**That risk is not hypothetical; the tree already contains two instances.**

- *"Unassessed means SQL NULL"* is implemented twice: `applyNullableStateFilter`
  in `library.ts` (`.is(col,null)` / `.in(col,concrete)` /
  `.or(is.null,in.(…))`) and `matchesAttributes` in `query.ts`
  (`mastery === null ? filters.mastery.includes("unassessed") : …`). One rule,
  two spellings, no test that binds them.
- *A narrowed rating band drops unrated problems*, because SQL comparisons
  against NULL are never true. `withinBand` gets this right with an explicit
  `rating !== null` — but a naive JavaScript port would write
  `r >= lo && r <= hi`, and `null <= 1600` is `true`. The correct behavior is one
  character away from a silent, filter-specific divergence.

### 12b. Resolution: one filter spec, two interpreters, three test layers

**Layer 1 — the fix.** Express each Library filter once, as a spec entry carrying
both interpretations:

```ts
const PROBLEM_FILTERS = {
    topic: {
        remote: (q, v) => q.in("topic", v),
        local: (c, v) => c.topic !== null && v.includes(c.topic),
    },
    difficulty: {
        remote: (q, [lo, hi]) => q.gte("rating", lo).lte("rating", hi),
        local: (c, [lo, hi]) =>
            c.rating !== null && c.rating.rating >= lo && c.rating.rating <= hi,
    },
    // …
} satisfies FilterSpec<Filters>;
```

`fetchProblems` folds the spec to build its query; the browse intent folds the
same spec to filter candidates. Adding a filter to one side only stops being
possible: `satisfies FilterSpec<Filters>` makes an unhandled key a **compile**
error, not a test failure. This is `hasComparableAnswer`'s "reused rather than
restated" applied to rules that cannot literally be shared — the nearest
available approximation of one definition.

**Layer 2 — per-filter truth tables (unit, no database).** For each spec entry, a
table of candidates × filter values asserting the local predicate, with nulls
first-class: null rating under a narrowed band, null mastery under `unassessed`,
null topic, empty tags, empty `officialSolutions`. This is where the SQL/JS null
gap is pinned, it is where nearly every real bug would live, and it costs one
fixture corpus that `src/lib/offline/fixtures.ts` largely already provides.

**Layer 3 — one narrow integration test.** Against local Supabase with a seeded
corpus, assert set equality for a handful of representative filter combinations,
including both null-sensitive ones above. This is the only layer that can catch a
layer-2 expectation being wrong in the *same direction* as the code it checks.
One test, not a suite.

### 12c. Exact parity is the wrong goal, and the preconditions are the contract

A local result is **supposed** to differ from the server in three cases, and a
suite that reports them as failures is itself wrong:

1. **A non-empty outbox** — the local overlay is ahead of the server by design;
2. **Frozen ratings** — the band filters on the package revision's rating, not
   live Glicko;
3. **Scope** — local is the downloaded subset (§2a).

So set equality is assertable only under stated preconditions: synced, empty
outbox, at the package revision, restricted to downloaded membership. Write those
into the contract beside the browse intent. With them, layer 3 is a small honest
test; without them, it is an impossible one that would be quietly weakened until
it proved nothing.

### 12d. Multi-package browse: union, with one dedupe rule

Browse spans the union of all ready packages. Shared state needs no work —
`ratings` and `personalState` are keyed `[userId, canonicalId]`, so a canonical in
two packages already resolves once.

`packageMembership` and `placements` are **not** deduped: both are keyed by
`packageRevision`, so a canonical present in two ready packages yields two
membership rows and the same `placementId` twice. The union must therefore
deduplicate by `placementId` when assembling candidates, and take the frozen
rating from the shared `ratings` store rather than from either package. This is
one line in the candidate assembly, but it is not free by construction the way
the shared stores are.

### 12e. Two mount paths, not one

The neutral shell is not the only way a local source gets mounted. There are two,
and only one involves the shell:

1. **Offline boot** — the document navigation failed, the worker returns the
   shell, and the shell mounts the presentation with a local source (§8a).
2. **Online with `downloaded-only`** — the network is fine, so the real `(app)`
   route boots and hydrates normally; only its *data source* resolves local.

The view component therefore takes its source as a prop in both cases, and the
route and the shell differ in nothing else. Anything that assumes "local source
implies degraded frame" is wrong in case 2, where the session is live and the
profile is present: an empty username slot is correct in case 1 and a bug in
case 2. Per §8d the nav is fully present in both, so the difference is confined
to server-only detail, not to chrome.

### 12f. Storage unavailable is a third state, not an offline state

`src/lib/offline/storage.ts` already types the failure as
`"unsupported" | "blocked" | "migration-failed"`, and `browser.ts` surfaces it
before any checkout. A page must render that distinctly from `offline`: Retry
cannot help, connectivity is irrelevant, and the honest message is that this
browser or profile cannot hold downloaded content. Folding it into `offline`
produces a Retry button that can never succeed.

### 12g. Smaller items, resolvable during implementation

- Whether `library.ts` takes a source parameter or binds a module-level source;
  either way it is 18 call sites.
- Whether `LibraryStore` filter state assumes any server-only semantics.
- Browse ordering must be a *total* order — `(problemNumber, canonicalId)` — and
  the behavior of an in-flight "load more" when the overlay changes underneath it
  needs defining.
- The label in §7c is a recommendation, not a decision.

## 13. Readiness

This document is a design specification. It is complete enough to **start**, and
not complete enough to **finish**, and the boundary is worth stating rather than
discovering at step 4.

**Ready to implement as written:** §11 steps 1–3. Every decision they need is
made, the mechanisms exist (`__pcOfflineRequestedUrl`, `connectivity.ts`,
`settings.svelte.ts`), and nothing about them is blocked on the sections below.

**Specified but not yet written down anywhere implementable.** All four gaps are
the same shape — *a fact that would end up stated in two places* — and each is
closed the same way: one declaration, two consumers. That is the same move as
`hasComparableAnswer` (§12a) and the filter spec (§12b).

1. **The contract text itself.** §6e describes the unified query type and browse
   intent; `offline-contracts.md` §4 still contains only `PracticeQueryV1`. Per
   `CLAUDE.md` that document changes *before or with* the shapes, so this is a
   gate on step 6, not documentation to follow it. *Fix:* one section, edited in
   the same change as the type — never a second description living beside it.
2. **Per-route offline behavior.** §5 says each page defines what renders without
   data, what is disabled and why, whether Retry is safe, what happens if
   connectivity changes mid-action, and what input survives. No page has been
   through that. *Fix:* do **not** write five prose answers per route. Declare one
   capability descriptor per presentation — the practice migration already
   proposed exactly this for modes — in the same mapping that §8b and §8c use, so
   a route's offline behavior, its allowlist entry, and its presentation are one
   record. Prose in this document then describes the type, not each route.
3. **The navigation allowlist contents.** §8b decides the policy; the pathnames
   are unwritten. *Fix:* they are the keys of the mapping in gap 2. There is no
   separate list to write.
4. **Shell consolidation.** *Fix:* §8c, scheduled as §11 step 4 — one document,
   reached before Library could add a third.

So the four gaps collapse to two pieces of work: write the query contract, and
write the presentation mapping. The mapping is the load-bearing one; once it
exists, gaps 2, 3, and 4 are its consumers rather than separate tasks.

**Status:** steps 1–3 are ready to build now and nothing above blocks them. Step
4 is decided (§8c, §8d) with two named costs inside it — guarding the layout's
network work, and verifying the navigation hook. Steps 6–7 wait on the two
pieces of work above. Step 8 stays out of scope.

**Not planned at all, deliberately:** step 8 (test/series catalog fields, §6c),
Coach's context resolver, and any offline write path. Each stays out of scope
until it has its own design.

**No file-level task breakdown exists.** This document says what must be true, not
which files change in what order. For steps 1–3 that gap is harmless — they are
small and localized. For steps 4–7 it is not, and the breakdown should be written
once the four items above are resolved.
