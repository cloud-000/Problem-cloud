# Offline Practice Route Refactor Migration

> [!IMPORTANT]
> **Decision (2026-08-13): keep the Session 3 offline data foundation, but retire
> its standalone trainer presentation.** Downloaded practice must use the normal
> Practice route and the same trainer UI as online practice. `/offline` remains
> the credential-free package manager and recovery entry point.

This migration replaces a parallel offline product surface with one practice
experience backed by two data sources. It does not roll back package download,
IndexedDB, snapshot-plus-overlay state, the outbox, foreground sync, or the
`TrainerDataSource` seam delivered in Session 3.

> [!NOTE]
> **Implementation status (2026-08-14): implemented.** Normal local Practice
> creates browser-owned sessions over the union of ready packages. Legacy
> `/practice?offlinePackage=<packageId>` links can still reload through the
> prerendered, credential-free
> `/offline-shell` document, which restores local account/package/session state
> from IndexedDB and never carries SvelteKit auth data. `/offline` is now a
> manager/launcher and the standalone trainer has been removed. Phase 6 stops at
> the existing V1 contract boundary: `PracticeQueryV1` and server-owned package
> sessions permit New/practice only, so no later mode is advertised or partially
> enabled.

## 1. Target behavior

1. A user downloads a package while online.
2. `/offline` lists storage downloads; `/practice` starts a normal local session
   without asking the user to choose one of them.
3. The Practice route selects exactly one source before mounting the trainer:
   online Supabase/session state, or the union of ready local packages.
4. The existing Practice layout, problem renderer, answer controls, history,
   keyboard behavior, and organization controls render for both sources.
5. An offline source never falls through to Supabase. Losing Wi-Fi during an
   ordinary online session does not silently convert that session into an
   offline source; the user starts or resumes a local Practice session explicitly.
6. Reloading an offline Practice URL is served by a credential-free practice
   app shell. It restores local identity and package/session state from
   IndexedDB without caching or trusting personalized SvelteKit data.

The local session parameter is a browser-owned identity, not authorization. The
repository still verifies the active local account and ready package revisions;
each write carries the checkout that supplied its canonical.

## 2. Product boundary during the migration

The first integrated release reuses the full Practice presentation but supports
only the local semantics already proven for **New** mode. Unsupported modes and
network-only actions remain visible only when that improves orientation, and
must be disabled with a direct explanation rather than partially working.

| Practice capability | First integrated offline release |
|---|---|
| New mode | enabled through `PracticeQueryV1` |
| Answer, skip, Back within local run | enabled |
| Mastery and engagement | enabled through the local overlay/outbox |
| Adaptive selection | enabled with the runtime-only shadow center |
| List and Skipped | disabled until local query members ship |
| Review and Mixed | disabled until provisional scheduling is specified |
| Test | disabled until ordered placements and atomic batch submission ship |
| Coach, Discuss, source links | disabled with an offline explanation |
| Server history outside the local run | unavailable |
| Mid-session settings edits | disabled; the downloaded session snapshot is fixed |

Using the normal UI does not imply that every online mode already has correct
offline data semantics. Capability checks belong to the selected data source,
not to scattered `navigator.onLine` checks in components.

## 3. Architecture changes

### 3a. Make Practice source-driven

- Move all remaining Supabase/session calls behind `TrainerDataSource` domain
  operations.
- Select and bind the source once in the route/controller. Do not branch per
  query or per write inside the trainer.
- Add an explicit capability descriptor for modes and network-only actions.
- Keep source identity stable for the mounted trainer. Changing package or
  returning online creates a new mount/session transition.
- If offline settings are editable, add a data-source operation and local
  persistence contract; do not let settings bypass the seam.

### 3b. Make `/practice` safely reloadable offline

The offline Practice entry must be a build-owned, credential-free shell. It may
not cache an SSR document, `__data.json`, cookies, tokens, or profile payloads.
Online auth/profile/session state is obtained only after the shell determines
that the online source is requested. Offline package boot reads only the local
account marker and IndexedDB repository.

The service worker may return this neutral practice shell for an explicit
offline Practice URL. Generic failed navigations continue to recover through
`/offline`; they do not invent a package or switch an online session's source.

### 3c. Remove the duplicate presentation

After the shared Practice surface passes the offline lifecycle tests:

- change package cards and download completion actions to launch `/practice`;
- remove `OfflinePractice.svelte` and its component-specific state;
- keep `/offline` focused on account state, storage, download, refresh, delete,
  sync status, and launch/recovery;
- move any useful copy or status treatment into shared Practice components.

Do not delete the standalone trainer before the normal route proves offline
reload, answer/skip persistence, session resume/finish, and reconnect sync.

## 4. Migration sequence

1. **Characterize parity.** Freeze the current Session 3 repository and source
   contract with tests, and inventory every direct network touchpoint remaining
   in the normal trainer.
2. **Extract capabilities and source binding.** Make the normal Practice
   controller accept one bound `TrainerDataSource`; route all supported writes
   and reads through it.
3. **Integrate New mode.** Launch a downloaded package into the normal Practice
   presentation, preserve package/session identity in the URL, and disable
   unsupported modes/actions explicitly.
4. **Add neutral Practice boot.** Prove direct offline reload and browser restart
   without personalized CacheStorage entries or server loads.
5. **Cut over and remove duplication.** Make `/offline` a manager/launcher and
   delete the standalone trainer after parity gates pass.
6. **Expand mode semantics.** Add List and Skipped; specify and implement local
   Review scheduling before Mixed; add Test only with complete ordered placement
   downloads and atomic batch submission.

Phase 6 is an ordered contract gate, not permission to widen only the UI. The
current V1 package-creation RPC rejects every session except New/practice and
`PracticeQueryV1.mode` is the literal `"new"`; consequently this migration does
not enable List or Skipped yet. Their query union members and session persistence
must land together first. Review follows only after a provisional scheduling
policy is added to the snapshot-plus-overlay contract, Mixed follows Review, and
Test remains last until packages prove complete ordered placement membership and
the sync wire owns an atomic final submission.

## 5. Verification and release gates

The refactor is complete only when Chromium and WebKit prove:

- online Practice still uses Supabase and preserves current behavior;
- a downloaded package opens in the same Practice UI;
- direct reload and browser restart at its Practice URL work with networking
  disabled;
- queries cannot escape package membership and never fall through to network;
- answers, skips, organization changes, current problem, and finish state
  survive reload and sync exactly once after reconnect;
- dropping Wi-Fi in a normal online session shows an offline/retry state and
  never changes source implicitly;
- unsupported modes and network actions cannot be entered accidentally;
- no personalized response, auth token, or answer-bearing SSR payload enters
  CacheStorage.

The existing 14-step acceptance scenario remains authoritative after its launch
and route assertions are updated. Repository, sync, SQL, and live-equivalence
coverage remain release gates; this migration changes presentation and boot,
not those contracts.

## 6. What is retained versus replaced

| Retain | Replace |
|---|---|
| Package/download APIs and checkout lifecycle | `/offline` as a practice presentation |
| Versioned IndexedDB repository | `OfflinePractice.svelte` |
| Snapshot-plus-overlay effective state | Offline-only trainer control flow |
| Typed outbox and foreground sync | Per-surface mode assumptions |
| `TrainerDataSource` online/offline implementations | Any implicit Wi-Fi-based source switching |
| New-mode query and shadow selection | Duplicate Practice styling and interaction code |

This is therefore a forward refactor, not a Session 3 rollback.
