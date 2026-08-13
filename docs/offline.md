# Offline Mode — Design Proposal

> [!IMPORTANT]
> **Status: proposal. Nothing in this document is built.** No service worker, no local
> cache, no outbox exists in the codebase as of 2026-08-12. This is the design and the
> reasoning behind it, plus the specific hazards found while tracing the current data
> path. Update the build-state table (§9) as slices land; until a row says shipped, the
> code does not do this.

The goal: a user selects a **scope** of problems the same way they scope a goal —
topic, series, division/format, year range — downloads it while online, and can
practice that scope with no network at all (a flight, a train), with their work syncing
correctly on reconnect.

Design decisions were settled 2026-08-12; §7 records what was chosen and why, including
the two that are non-obvious (timestamp anchoring, multi-device collisions).

---

## 1. SSR is not the obstacle

The instinct is that Supabase SSR makes offline hard. It does not, because the app
barely uses SSR for data:

- **One server load exists in the entire app**: `src/routes/+layout.server.ts` (session,
  profile, and a `last_active_at` touch). There is no `+page.server.ts` under `(app)/`.
- **Every read and write is client-side**, through the browser Supabase client, via
  `$lib/library.ts`, `$lib/trainer.ts`, `$lib/progress.ts`, `$lib/sessions.ts`. All of
  these already take `supabase` as their first argument, which is the natural seam for a
  local implementation.
- **Grading already happens in the browser** (`answersMatch`, `PracticeView.svelte:1458`).
  The answer key is therefore *already* shipped to the client for any problem being
  attempted; offline grading discloses nothing new.
- **Problem content is pure text.** No storage buckets, no image URLs — figures are
  Asymptote source rendered client-side by `src/lib/asy/`. A 25-problem test with
  official solutions is on the order of 100–200 KB, so a downloaded scope is small and
  IndexedDB is comfortably sufficient.

Offline is therefore not an SSR rearchitecture. It is four separable problems, and only
two of them are hard: **identity** and **writes**.

---

## 2. Shell and assets

There is no `src/service-worker.ts`. Add one built on `$service-worker`'s `build`/`files`
manifest: precache the app shell, and answer navigations **cache-first** when the network
is unavailable.

Two hazards, both easy to miss and both fatal on their own:

- **KaTeX and the icon font are loaded from CDNs.** `src/app.html` pulls
  `katex.min.css` / `katex.min.js` / `auto-render.min.js` from `cdn.jsdelivr.net` and
  Material Symbols Rounded from `fonts.googleapis.com`. Offline that means **no math
  rendering and no icons** — the app is unusable no matter how good the data cache is.
  **Decision: self-host both** (§7 D6), which also removes two CDN dependencies from the
  critical render path for online users. Self-hosting the icon font changes the subset
  workflow, so `scripts/icon-subset.ts` (and the test that fences it) must learn the new
  location.
- **`authGuard` must never be reached offline.** `src/hooks.server.ts:86` redirects
  unauthenticated requests to `/auth/login`. Offline, a navigation that reaches the
  Worker simply fails and the browser shows its own offline page instead of the app. The
  service worker has to answer navigations before the network, not fall back to it.

The root layout's server data (`__data.json`) is fetched on every client navigation
because the root layout has a server load. Cache it stale-while-revalidate; offline,
`+layout.ts` takes the `isBrowser()` branch anyway and never needs the server client.

---

## 3. Identity offline is not a session

This is where offline-Supabase attempts usually die. Access tokens expire in an hour
(`supabase/config.toml:187`, `jwt_expiry = 3600`); `autoRefreshToken` fails mid-flight,
and the resulting auth events are easy to mistake for a sign-out — at which point the
app helpfully throws away the user's downloaded work.

**The rule: offline identity is a locally persisted profile, not a live JWT.** Capture
`{ userId, username, profile }` while online. Gate the offline UI on *"there is a local
profile and a downloaded scope for this user id"* — never on a valid session. Nothing
offline touches PostgREST, so no token needs to be valid for any of it to work.

Consequences:

- A failed token refresh while `!navigator.onLine` **must not** clear local state. An
  explicit `offline` flag in app state, set from connectivity plus failed-request signal.
- On reconnect, refresh normally. If the refresh token is dead, **require login before
  flushing the outbox**. The outbox is keyed by `userId`, so it survives re-login intact
  and flushes afterward.
- Refresh-token rotation is on (`config.toml:193`) with a 10s reuse interval, so multiple
  tabs racing a refresh on reconnect can burn each other's token and force a re-login.
  The outbox must be durable across that, which the `userId` keying already gives.
- Do not attempt to extend token lifetimes to cover a flight. The fix is to stop needing
  a token, not to hold one longer.

---

## 4. Reads: download a scope, walk a queue

### 4a. Scope selection reuses the goal scope resolver

A downloaded scope is the **same shape as a goal's scope** — topic, `seriesIds`,
per-series divisions/formats, year range — and resolves through the same function:
`public.goal_scope_canonicals(p_scope jsonb)` (`supabase/schemas/goal_scope.sql:121`).
It is `stable` / `security invoker`, returns `(canonical_id, gradeable)`, and is measured
at ~20ms for a two-series scope and ~87ms for the whole catalog.

This is a hard rule inherited from the goals layer: **scope always resolves through
`goal_scope_canonicals` — never re-derive it.** The download path is a new caller, not a
new resolver, and the scope editor UI in `src/routes/(app)/goals/` is the model for the
picker.

### 4b. The server draws the queue, not the client

Do **not** port the trainer's draw functions offline. `fetchNewProblem`,
`fetchDueReviewProblem`, and friends (`src/lib/trainer.ts:616-683`) are rating-band and
exclusion-list SQL against `problem_ratings` and `problem_progress` with random offsets.
Reimplementing that locally is a large surface that will silently drift from the SQL —
the same failure mode the client-side rating mirror is explicitly guarded against (see
[`docs/ratings.md`](./ratings.md)).

Instead, **"download a scope" means the server hands back a pre-drawn, ordered queue.**
One RPC resolves the scope, applies the draw, and returns:

- the problem rows for the queue,
- the user's `problem_progress` rows for them,
- current `problem_ratings`,
- and a **pre-minted `practice_sessions` row**.

Pre-minting the session while still online is what sidesteps local-id→server-id mapping
entirely: every offline submission already has a real `session_id` to point at, so replay
needs no id rewriting.

### 4c. The trainer walks the queue

Test format already loads a whole test upfront (`fetchTestProblems`,
`PracticeView.svelte:321`), so it needs nothing new. Practice mode draws one problem at a
time (`drawIndex`, `fetchProblemById`, lines 548/1337) and is where the work is: offline,
the draw resolves against the cached queue instead of a round trip.

### 4d. Cache freshness

A scope goes stale — ratings move, progress changes on other devices. **Max age is 5
days** (§7 D5), with a manual re-sync button. Staleness **warns, it does not block**:
refusing to open a queue on day six mid-flight is the worst possible failure mode. A
stale scope shows a resync prompt and is excluded from background refresh; queued work
still runs, and un-flushed outbox entries are never discarded for staleness.

### 4e. The `choices` hazard travels with the cache

A downloaded scope contains answer keys (`choices[answer_index]` for free-response — see
CLAUDE.md). Every offline read path must gate on `isMultipleChoice()` exactly as the
online one does, and if Coach context is compiled offline, `test-locked` must still
withhold the key **structurally** rather than by asking the model.

---

## 5. Writes: an outbox of raw submissions, replayed

The architecture is unusually well suited here. Ratings and SM-2 progress are **DB-owned
and derived from `submissions` by trigger**, and `docs/ratings.md` already commits to a
live ≡ replay determinism contract. So the offline write model falls out:

**Queue raw submission rows locally; replay them in order on reconnect; let the triggers
derive everything else.**

- Do **not** compute Glicko client-side. The mirror in `src/lib/library.ts` is a preview
  and is explicitly subordinate to the SQL.
- Do **not** persist optimistic progress as if it were truth. Show optimistic UI; treat
  the server as authoritative once the flush completes.
- Flush strictly in timestamp order — the encounter trigger assumes chronological arrival
  (§6a).
- The Test-format batch insert (`PracticeView.svelte:405`) drops into this cleanly — it
  is already one atomic batch of rows.

Also outbox: the `problem_progress` mastery/engagement RPCs (`src/lib/progress.ts`), and
Coach message persistence (§8).

**The flush cannot be a pure client→PostgREST write.** Both repair functions
(`recompute_problem_progress`, `recompute_ratings`) are service_role, so reconnect needs
an `/api/sync`-style endpoint. The precedent is `/api/ai/messages`, which writes
service-role for the same class of reason — but note this is the first non-Coach
server-side write in the app.

---

## 6. Timestamps, and why they are the crux

Everything derived from a submission keys off `created_at`, in three different ways:

| Consumer | Needs |
|---|---|
| Rating replay fold (`recompute_ratings`) | relative **order** only |
| Encounter grouping (`set_submission_encounter`) | **deltas** within a `(user, problem)` pair |
| SM-2 `next_review_at`, RD staleness inflation, history display | **absolute** value |

### 6a. Anchored relative timestamps

Naively stamping every offline row at flush time is actively wrong: the encounter trigger
(`ratings.sql:341`) compares `new.created_at - prev.created_at` against `encounter_gap`,
so a block of rows all sharing one timestamp collapses separate sittings on the same
problem into a single encounter and inflates `attempt`. Naively trusting the device clock
is also wrong — laptops crossing timezones mid-flight adjust it.

**The client records a monotonic offset (`performance.now()`) per submission, not a wall
clock, and the server anchors the block at flush:**

```
created_at = flush_time − (last_offset − this_offset)
```

The final offline submission lands at flush time; everything before it keeps its true
spacing. Properties:

- encounter deltas are **exact**,
- replay order within the user is **exact**,
- backdating is **bounded by the offline block's duration** and never more,
- `next_review_at` shifts by at most that duration,
- device clock skew and timezone changes are irrelevant,
- the server-side clamp is trivial: every row in a flush must land in
  `[now − max_window, now]`.

**Residual drift, accepted:** other users' matches that landed during your offline window
sort before your backdated rows in the global replay but arrived after them live, so live
state diverges from a full rebuild by a bounded amount until the next
`recompute_ratings()`. `recompute_ratings()` takes no arguments — it is a **global**
replay with no per-user variant, and one is not really definable, since your matches move
*problem* ratings that every other player shares. This is exactly the drift the repair
path was built to absorb.

### 6b. What actually changes in the schema

`created_at` needs **no grant or column change** to become client-supplied: the grant is a
plain `grant select, insert` with no column restriction (`submissions.sql:333`), and
`set_submission_encounter` already reads `new.created_at` rather than `now()`. The change
is only the **clamp trigger** described above, to stop a client stamping rows outside the
allowed window.

The one genuine addition is an **idempotency key**: a nullable client-generated
`client_key uuid`, unique per user, so a partially-failed flush is retryable without
duplicating rows. Direct precedent — the Coach deliberately mints conversation and
message ids in the browser for exactly this reason (CLAUDE.md, "The browser owns
conversation and message identity").

Regenerate `src/lib/types/database.types.ts` after either change.

### 6c. Multi-device collisions

The failure is specific. You solve problem #500 offline at 14:00; your phone solves #500
online at 15:00; you flush at 18:00 and the row is anchored back to ~14:00. The encounter
trigger picks `prev` by `order by created_at desc` — the 15:00 row — computes a *negative*
delta, finds it is not greater than `encounter_gap`, and files the 14:00 attempt as
attempt #2 of an encounter that began after it. The annotations are wrong, which
mis-weights the rating slightly and mis-orders analytics. It does not corrupt anything.

Mitigation, in order of cost:

1. **Advisory device checkout.** The flag is set at *download* time — "this device has a
   scope checked out" — and cleared at flush, because a device cannot announce it is
   offline *while* offline. Other devices show a warning banner. It is advisory, not a
   lock; there is no way to actually stop the other device.
2. **Collision detection at flush.** The sync endpoint can see any existing submission for
   the same `(user, problem)` newer than an incoming row, and repair those problems
   specifically.
3. **An annotation repair function.** `recompute_problem_progress(p_user_id, p_problem_id)`
   (`submissions.sql:461`) rebuilds counters and the SM-2 schedule but **not** the
   `encounter` / `attempt` / `encounter_ms` annotations. A full repair wants a companion
   `recompute_submission_encounters(user, problem)`, which does not exist yet.

---

## 7. Decisions (settled 2026-08-12)

| # | Decision | Choice |
|---|---|---|
| D1 | Rating fidelity vs. honest timestamps | **Anchored relative timestamps** (§6a) — backdating bounded to the offline block, drift absorbed by the global repair path |
| D2 | v1 scope | **Full**: goal-style scope picker, practice-mode queues, IndexedDB store, trainer walks the cached queue |
| D3 | Scope granularity | Same shape as a goal's scope, resolved by `goal_scope_canonicals` (§4a) |
| D4 | Multi-device conflicts | **Advisory checkout flag** set at download, cleared at flush, plus flush-time collision repair (§6c) |
| D5 | Cache freshness | Manual re-sync button; **5-day max age**; stale warns, never blocks (§4d) |
| D6 | Self-host KaTeX + icon font | **Yes**, unconditionally — it benefits online users too |

---

## 8. The Coach works offline, for the case that matters

BYOK against a local Ollama/vLLM on the same laptop is *the* flight scenario, and it
already works by construction: the browser talks straight to the model with no proxy hop
and no server involvement. Cloud providers obviously will not.

`/api/ai/messages` persistence is already best-effort and off the streaming path, so it
degrades correctly rather than surfacing as a failed answer — route those writes through
the same outbox so the transcript is not lost.

---

## 9. Build order and state

| # | Slice | State |
|---|---|---|
| 1 | Self-host KaTeX + icon font; update `scripts/icon-subset.ts` and its test | not started |
| 2 | Service worker: precache shell, cache-first navigations | not started |
| 3 | Offline identity: local profile, `offline` state flag, no sign-out on refresh failure | not started |
| 4 | Download-scope RPC (`goal_scope_canonicals` + draw + pre-minted session) | not started |
| 5 | IndexedDB store; scope picker UI; trainer walks the cached queue | not started |
| 6 | Outbox + `/api/sync` flush: clamp trigger, `client_key`, anchored timestamps | not started |
| 7 | Device checkout flag + flush-time collision repair | not started |

Slice 1 is worth doing regardless of whether offline ever ships.

**Still to measure** (both affect sizing, neither blocks design):

- Real payload size per scope — `pg_column_size` over `problems` for a representative
  scope, which sets download expectations and any storage cap.
- Global `recompute_ratings()` runtime at current data volume, which decides whether a
  scheduled repair is viable or whether §6a's residual drift persists until an admin runs
  one.

---

## 10. Non-goals

- **No local Postgres (PGlite or otherwise).** Replicating the rating and SM-2 triggers
  offline means two implementations of the thing the repo insists has exactly one.
- **No client-side rating math beyond the existing preview.** Ratings settle on flush.
- **No offline-first rewrite.** Online remains the normal path; offline is a downloaded,
  bounded, explicitly-entered mode.
- **No offline library browsing, goals, history, or analytics in v1.** Each is a set of
  live queries and its own port; those routes show an honest offline state instead.
