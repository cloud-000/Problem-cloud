# Device-Local Guest Practice Plan

> **Status:** proposed replacement for the deferred
> [anonymous-account plan](./anonymous-practice-plan.md).
>
> **Goal:** let a visitor solve problems immediately, saving lightweight
> practice state only in the current browser until they choose to create an
> account.

## 1. Product decision

Guest Practice is unauthenticated and device-local. It does **not** create a
Supabase anonymous user and it does **not** write guest progress to the
database. The catalog is already public-read, so a visitor can fetch the
problem content needed for practice without a session.

The browser stores the guest's selected answer, in-progress problem, and
lightweight local practice history in IndexedDB. Prefer IndexedDB over
`localStorage`: it supports structured records, room for a useful history, and
an eventual offline cache without putting the full state in synchronous
key-value storage.

Product copy must state plainly:

> “Your practice is saved in this browser. Create an account to save progress
> across browsers and devices.”

| Capability | Device-local guest | Registered account |
| --- | --- | --- |
| Read public catalog and solve free-practice problems | Yes | Yes |
| Keep state after reload in the same browser profile | Best effort | Yes |
| Use another browser or device | No | Yes |
| Server submission history, SM-2 progress, ratings | No | Yes |
| Library, tests, review, Coach, goals, offline packages | No | Yes |

“Best effort” matters: clearing site data, private-browsing storage, browser
profile changes, storage eviction, or a new device can discard guest state.

## 2. Scope and boundaries

V1 offers only the existing free-practice experience, adapted to read and
write local state. It must not use authenticated-only user data as a fallback.

- Guest catalog reads use the existing public `series`, `tests`, and `problems`
  policies.
- A guest never inserts `submissions`, `practice_sessions`, or
  `problem_progress`, and never calls a user-owned RPC.
- A guest cannot use account routes or server capabilities: Library, tests,
  review, history, goals, Coach, offline package creation/sync, settings,
  social surfaces, and admin remain signed-in features.
- No guest attempt affects ratings, aggregate solve-time data, quotas, or any
  server analytics derived from authoritative practice records.

This removes the need for anonymous sign-ins, identity linking, guest-specific
RLS exceptions, daily submission quotas, guest cleanup, and
`rating_eligible` provenance. It also means the previous plan's conversion
draft is unnecessary: a guest has no server-side identity or submission to
preserve.

## 3. Local data model

Use a versioned IndexedDB database with a small, explicit schema. Records must
contain only data needed to restore the guest experience, for example:

- an active free-practice problem reference and answer draft;
- local attempts keyed by canonical problem id, with outcome and timestamps;
- local presentation/progress hints such as seen count or locally solved;
- dismissible account-prompt state.

Do not treat this data as trusted or authoritative. It is editable by the
visitor and may be incomplete, stale, or lost. In particular, it must not
become a source for server submission records, Glicko ratings, leaderboards,
achievements, quotas, or anti-abuse decisions.

Use canonical problem ids for local state so duplicate placements do not split
the same problem's local history. If catalog revisions make a stored problem
unavailable, recover gracefully by choosing a new problem and retaining any
unaffected records.

## 4. Account creation and transfer

Creating an account begins ordinary account creation; it is not an anonymous
identity upgrade. V1 starts durable, server-backed practice state at account
creation and must not silently upload the local guest history.

After a successful signup or sign-in, explain that browser-local guest
practice stays on that device and the account now records new practice across
devices. The app may retain the local guest store until the user clears it, but
must keep it visually separate from account history.

A later opt-in import can be designed separately. If added, it is a convenience
feature, not a historic submission migration: import only non-competitive
personal hints after explicit confirmation, and never use imported records for
ratings, statistics, achievements, or other authoritative state. The import
contract must define collision behavior and be independently reviewed before
any server write is added.

## 5. Answer-key and public-content boundary

Public catalog access is not answer-key protection. The existing `problems`
public-read policy exposes problem fields to an unauthenticated caller,
including answer-related data. Guest UI should still follow normal rendering
rules and avoid displaying answer keys before a submission, but this is a
product presentation rule rather than a security boundary.

If protecting unpublished or answer-key data becomes a requirement, it needs a
separate catalog/API design; merely requiring a guest session would not solve
that problem.

## 6. Implementation phases

### Phase 1 — local practice foundation

- Define and test the versioned IndexedDB adapter, migrations, and corruption
  recovery.
- Allow the public entry surface to launch local free practice without creating
  an auth session.
- Route guest practice reads through the public catalog and write only local
  records.
- Keep account-only routes and APIs unavailable to unauthenticated visitors.
- Add clear device-local persistence and account-creation copy.

### Phase 2 — polish and measurement

- Handle catalog changes, deleted local data, quota-free unlimited practice,
  and cross-tab behavior gracefully.
- Add privacy-safe funnel instrumentation only after selecting an analytics
  transport; do not send raw problem text, answers, or database user ids.
- Evaluate practice-start and signup conversion before expanding the guest
  feature surface.

### Phase 3 — optional import proposal

- Only if supported by user research, write a separate design for an explicit,
  non-authoritative import of local progress hints after signup.
- Do not reuse or partially implement the deferred anonymous-account plan for
  this feature without a new security and data-ownership review.

## 7. Acceptance criteria

- A visitor can begin and complete free practice without authentication.
- Reloading the same browser profile restores an in-progress answer and local
  practice state when browser storage remains available.
- No unauthenticated action writes user-owned practice data to Supabase.
- Guest activity cannot change ratings, progress, history, quotas, or any
  account-owned server state.
- The UI accurately communicates that clearing browser data or changing
  browsers/devices can lose guest practice.
- Signing up starts a normal account without claiming that local guest history
  has been transferred.
