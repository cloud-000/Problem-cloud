# Guest Practice Plan

> **Status:** proposed — not implemented.
>
> **Goal:** let a visitor start solving immediately, retain their work in the
> current browser, and convert that work into a durable account when they choose
> to sign up.

## 1. Product decision

Introduce a **Guest Practice** tier backed by a Supabase anonymous user. It is
not an unauthenticated/public session: an anonymous user has an authenticated
Supabase session and a stable user id while the browser retains its session
data. That gives the existing progress and root practice-session model an owner
without asking for email, password, or a username first.

V1 optimizes for trying the core loop. A guest may use only the always-present
root free-practice session. Library, review, test, goals, history, offline, AI
Coach, settings, social, and admin surfaces remain account-only.

| Capability | Guest | Registered account |
| --- | --- | --- |
| Free practice and single-answer submissions | Yes, subject to quota | Yes |
| Progress while this browser retains its guest session | Yes | Yes |
| Return after clearing browser data / from another browser or device | No guarantee | Yes |
| Username and public profile | No | Yes |
| Other practice modes and account features | No | Yes |
| Rating that changes the shared problem-difficulty pool | No | Yes |

The product copy must say plainly: **“Your guest progress is saved in this
browser. Create an account to keep it across browsers and devices.”** Do not
describe a guest session as a permanent account or imply that another browser
on the same device can recover it.

## 2. Funnel, prompts, and draft recovery

1. A visitor selects **Practice as guest** from the welcome/login surface.
2. The browser creates an anonymous session and enters the root free-practice
   flow without a username-completion redirect.
3. Show a low-pressure account prompt after the first solved problem and again
   at 25 counted submissions. It must be dismissible; dismissing it does not
   change the hard quota.
4. At the guest quota, stop every new counted submission, including a skip or
   ungraded response, and present account creation as the way to continue.
5. Before opening an email-verification or OAuth flow, persist a browser-local
   conversion draft keyed by guest user id, practice session id, and problem id.
   It contains the selected choice or free response, elapsed time, tries used,
   flags, and enough route state to restore the same problem.
6. Keep the conversion draft until the submission succeeds, the user explicitly
   discards it, or the active user id no longer matches it.
7. On conversion, link an identity to the existing anonymous Supabase user. The
   user id must remain unchanged, so existing submissions, progress, and
   practice sessions remain attached.

The 25-submission prompt is a product experiment, not a security boundary.

## 3. Authentication and profile model

### 3.1 Enable anonymous sign-ins

Enable anonymous sign-ins in both the Supabase project settings and local
`supabase/config.toml`. The local configuration currently disables them. Also
enable manual identity linking, which is required for the upgrade path.

Create the guest session in the browser with
`supabase.auth.signInAnonymously()`. The existing `handle_new_user` trigger can
continue to create the profile and root practice session: nullable
`profiles.username` accommodates a guest.

### 3.2 Route and username boundaries

`src/routes/(app)/+layout.server.ts` currently redirects every signed-in user
whose profile lacks a username to `/auth/complete-profile`. Change the decision
so that:

- an anonymous user may enter `/practice` without a username;
- an anonymous user is redirected away from every other account-only app route;
- a permanent user with no username still completes their profile;
- guest surfaces show “Guest”, never a fabricated username.

The route guard relies on the JWT-validated `user.is_anonymous` value constructed
by `safeGetSession`, never on client-provided metadata.

The username boundary must also exist in the database. A guest must not be able
to navigate directly to `/auth/complete-profile` or invoke
`claim_profile_username` through the Data API. Add an anonymous-user rejection
to both the route action and the security-definer RPC. Apply the same rule to
account-only profile fields: a guest may receive trigger-owned activity updates,
but may not set a username, status, focused series, or other preferences.

### 3.3 Upgrade, do not create a second user

The account-creation UI for a guest is an **upgrade** flow, not the existing
ordinary `signUp` form. It first writes the conversion draft from §2.

- **Email:** call `auth.updateUser({ email })`, complete verification through a
  dedicated callback or OTP continuation, refresh and validate the session, and
  only then call `auth.updateUser({ password })`. Route the converted user
  through username completion before returning to the conversion draft.
- **OAuth:** call `auth.linkIdentity({ provider, options })` with a dedicated
  upgrade callback. The callback exchanges the code, verifies that the returned
  user id matches the conversion draft, routes through username completion when
  needed, and then returns to the draft. Preserve the intended return route in a
  signed or server-controlled OAuth intent, not a client-trusted redirect URL.
- **Existing identity:** v1 does not merge. Explain that continuing will abandon
  the guest identity and its progress, require explicit confirmation, then sign
  out the guest and begin normal sign-in. The current auth guard redirects an
  active session away from `/auth/login`, so discard must occur first. Never sign
  out the guest merely because an identity-link attempt failed.

Successful upgrade must preserve the session's user id. Verification completed
in another browser can preserve database rows and identity, but cannot promise
to recover the originating browser's unsubmitted answer.

References: [Supabase Anonymous Sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous),
[identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

## 4. Guest quota

### 4.1 Policy

Guest users may create at most **100 counted submissions per UTC day**. Count
every accepted free-practice interaction, including skips and ungraded
responses. Counting accepted interactions rather than rendered problems is
auditable and cannot be bypassed by changing the client.

The product may later change what counts, but enforcement must remain a single
database-owned rule rather than a client distinction.

### 4.2 Database enforcement

Implement the quota in the declarative Supabase schema, in a `BEFORE INSERT`
submission trigger:

1. Identify a guest from the trusted JWT `is_anonymous` claim.
2. Atomically reserve one unit in `guest_daily_usage`, keyed by
   `(user_id, usage_day)` with `usage_day` derived from database time in UTC.
3. Reject an insert that would exceed 100 with the stable marker
   `GUEST_DAILY_QUOTA_EXCEEDED`.
4. Let permanent users bypass the guest-only limit.

Use a row-level atomic upsert/update guarded by `count < 100`, or an equivalent
locked security-definer function. Do not use `count(*)` followed by an insert:
concurrent tabs could both pass. A failed insert must roll back its reservation.
The counter's primary key is the required index; submission time performs no log
scan.

`guest_daily_usage.user_id` references `profiles(id) on delete cascade`; its
counter is constrained to `0..100`. Clients receive no direct insert, update, or
delete grant on the table. If the UI displays remaining usage, expose only the
caller's current-day value through RLS or a narrow read function.

The UI may display advisory remaining usage, but it must handle a race-caused
database rejection. Every submission surface maps the stable marker to the same
quota experience without clearing the answer.

PostgreSQL statements are atomic. If a future guest-eligible surface submits a
multirow batch that would cross the remaining quota, reject the entire batch;
never partially accept it. V1 avoids that experience by allowing only
single-interaction free-practice writes.

## 5. Authorization and abuse controls

Anonymous Supabase users use the `authenticated` Postgres role. Audit every
authenticated write before enabling guest traffic and explicitly classify it as
guest-allowed or account-only.

Enforce each account-only restriction at every boundary that exposes it:

- Tables and RPCs reachable through the Supabase Data API enforce the rule in a
  restrictive RLS policy or inside the function. A SvelteKit check cannot protect
  a directly callable database RPC.
- SvelteKit endpoints reject an anonymous user from the JWT-validated `User`,
  even when their downstream client uses `service_role`.
- Capabilities exposed through both paths require both checks.

Use `(select (auth.jwt() ->> 'is_anonymous')::boolean) is false` in restrictive
RLS and the equivalent check in security-definer functions. Supabase policies
are permissive by default, so adding another permissive owner policy is not a
guest restriction.

At minimum, restrict:

- AI Coach and all server-side AI persistence endpoints;
- offline package creation and sync, including directly callable offline RPCs;
- goals, account preferences, feedback, and notification-read writes;
- `claim_profile_username`, profile preferences, roadmap votes, and
  problem-classification RPCs;
- every admin action, in addition to existing admin-rank checks;
- public/community-facing writes added later.

Enable Cloudflare Turnstile or hCaptcha for anonymous sign-in, retain Supabase's
IP-based anonymous-sign-in limit, and set production deliberately. Local config
currently specifies 30 anonymous sign-ins per IP per hour when enabled.

Anonymous accounts persist in `auth.users`. Before launch, schedule deletion of
unconverted anonymous users whose `profiles.last_active_at` is more than 30 days
old. Selection must join `auth.users` and require `auth.users.is_anonymous is
true` at deletion time; never infer conversion from a nullable email or stale
JWT. A database test must prove that existing cascades remove the profile, root
session, submissions, progress, usage rows, and other user-owned data. Never
delete converted users.

References: [Supabase anonymous-user access control and abuse prevention](https://supabase.com/docs/guides/auth/auth-anonymous),
[Supabase production rate limits](https://supabase.com/docs/guides/deployment/going-into-prod).

## 6. Ratings and deterministic provenance

The current rating pipeline treats each graded submission as a live Glicko
match. Guest identities are inexpensive to recreate, so their attempts must not
change player ratings or the shared problem-difficulty pool.

Add `submissions.rating_eligible boolean not null default true`. Existing rows
backfill to `true`. A `BEFORE INSERT` trigger overwrites the field for every
authenticated Data API insert: `false` when the signed JWT says the caller is
anonymous, otherwise `true`. The client value is never authoritative. Any
future trusted/service-role submission writer must explicitly derive the value
for the identity on whose behalf it writes.

Rows captured with `rating_eligible = false` remain in submissions and progress,
but are excluded from `handle_submission_rating` and every rating replay input:

- guest answer history and SM-2 progress work normally;
- guest rows never seed or change `player_ratings`, `problem_ratings`, rating
  history, or problem solve-time EWMA;
- after conversion, future submissions are eligible;
- pre-upgrade rows remain ineligible forever, including after conversion;
- replay reads only `submissions.rating_eligible`, never the user's current
  anonymous status.

Encounter annotations continue to include guest submissions because they
describe the submission/progress log. Replay may re-derive them for all rows,
but only eligible rows participate in rating state.

Update `supabase/schemas/ratings.sql`, `docs/ratings.md`, generated database
types, and live-versus-replay tests. `docs/ratings.md` remains authoritative for
the rest of the pipeline.

## 7. Implementation phases

### Phase 0 — instrumentation and threat inventory

- Inventory every authenticated table, policy, RPC, SvelteKit endpoint, and app
  route; classify each as guest-allowed or account-only.
- Define analytics events: guest created, first problem shown, first submission,
  first solve, prompt shown/dismissed, quota reached, upgrade
  started/completed/failed, and confirmed guest discard.
- Assign the cleanup job and abuse-monitoring operational owner.

### Phase 1 — safe guest practice

- Enable anonymous sign-ins, manual linking, and CAPTCHA only in development and
  a non-production environment.
- Add the guest entry UI and anonymous session creation.
- Allow guests only on `/practice` and only in the root free-practice session;
  hide and server-reject every account-only mode and route.
- Allow an anonymous user without a username while blocking guest username and
  profile-preference mutations at both app and database boundaries.
- Add the atomic quota and stable quota-reached experience.
- Add trusted `rating_eligible` provenance and exclude guest rows from live
  rating and replay, with live-versus-replay tests. This is a launch prerequisite.
- Add conversion-draft persistence and prove a quota rejection leaves the answer
  intact.
- Complete the Data API, RPC, and SvelteKit authorization audit.

### Phase 2 — conversion and retention

- Build email and OAuth identity-linking flows, including verified-email,
  username-completion, callback, and existing-identity error states.
- Prove successful upgrade retains user, submission, progress, and session ids,
  then restores the conversion draft.
- Implement confirmed discard before existing-account sign-in. V1 performs no
  merge.
- Add 30-day cleanup, cascade tests, monitoring, and an operational runbook.

### Phase 3 — limited rollout

- Enable the funnel for a small traffic cohort.
- Monitor anonymous creation, CAPTCHA failures, quota rejections, database
  growth, cleanup, request errors, and conversion.
- Compare practice-start and first-solve rates with the signed-up-only funnel.
- Expand only if abuse and storage costs remain within budget and conversion
  gains are material.

## 8. Acceptance criteria

- A visitor completes a free-practice problem without email, password, or
  username.
- A guest may submit exactly 100 counted interactions in a UTC day; concurrent
  tabs cannot exceed the quota.
- The 101st graded answer, skip, or ungraded response is rejected server-side,
  and the UI preserves the in-progress work.
- Guest progress survives reload while the same browser session is retained.
- A successful upgrade preserves the user id and all existing personal practice
  data, requires username completion, and restores the unsubmitted answer in the
  originating browser.
- A guest cannot claim a username or mutate account-only profile fields through
  either an app route or the Data API before conversion.
- Existing-account sign-in requires explicit acknowledgement that v1 abandons
  the guest identity; a failed link never signs the guest out.
- Clearing browser data or signing out communicates non-recoverability.
- Guest-era submissions cannot affect live or replayed ratings, even after
  conversion.
- Account-only endpoints, tables, and RPCs reject a guest despite the
  `authenticated` role.
- CAPTCHA, rate limits, quota races, callback identity, rating provenance,
  conversion, and cleanup have automated tests or operational checks appropriate
  to their layer.

## 9. V1 decision log

1. The hard limit is 100 counted submissions per UTC day. Prompts begin earlier
   but do not enforce a lower limit.
2. Existing-account sign-in requires confirmed abandonment of the guest
   identity. V1 does not merge guest data into an existing account.
3. Pre-upgrade submissions are permanently rating-ineligible. There is no
   one-time rating backfill after conversion.
4. Guests may use only the root free-practice flow. Library, review, and test
   modes remain account-only.
5. Unconverted guests are retained for 30 days after `profiles.last_active_at`.
   Converted users are never selected by cleanup.

These values may change after rollout analysis, but implementation must update
the decision log, enforcement, copy, and tests together rather than treating a
client experiment as policy.
