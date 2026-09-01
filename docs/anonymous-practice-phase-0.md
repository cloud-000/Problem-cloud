# Guest Practice — Phase 0 inventory

> **Status:** complete on 2026-09-01. This is the authorization and
> instrumentation contract for Phase 1; it intentionally makes no guest-facing
> behavior live.

Anonymous Supabase users are in the `authenticated` Postgres role. Therefore
existing owner checks (`auth.uid() = user_id`) admit a guest unless a restrictive
anonymous-user check is added. The source of truth for that distinction is the
JWT-validated `User.is_anonymous` assembled by `safeGetSession()` in
`src/hooks.server.ts`, and the database equivalent is
`(select (auth.jwt() ->> 'is_anonymous')::boolean) is false`.

## Classification legend

| Classification | Meaning | Phase 1 enforcement target |
| --- | --- | --- |
| Guest allowed | A guest needs this capability for the root, online free-practice loop. | Keep its owner checks; add the quota and rating-provenance triggers where applicable. |
| Account only | A guest must not use or mutate this surface. | Add a restrictive non-anonymous RLS policy or function check, and an endpoint/route check when one exists. |
| Public read | It is available before sign-in and is not a guest capability decision. | No anonymous-user restriction. |
| Internal | Callable only by trusted database/server work. | Preserve service-role-only grants; no guest path. |

## Database tables, views, and policies

| Surface | Current authenticated access | Classification | Phase 1 change / verification |
| --- | --- | --- | --- |
| `profiles` | Own-row update; public read | Account only writes; public read | Restrict the existing update policy for guests. The `handle_new_user` and activity trigger writes remain trusted. |
| `practice_sessions` | Own-row select/insert/update/delete | Guest allowed only for the trigger-created root session and its in-place practice state | Route/UI must never create, rename, end, delete, or switch a guest session. Add a restrictive anonymous-session policy so direct Data API inserts/deletes and mutations outside the root loop cannot bypass that decision. |
| `submissions` | Own-row select/insert | Guest allowed | Add atomic daily quota and trusted `rating_eligible` provenance in `BEFORE INSERT` triggers. |
| `problem_progress` | Own-row select | Guest allowed | Trigger-owned progress updates only; no direct write grant exists. |
| `series`, `tests`, `problems`, `catalog_revision` | Public select | Public read | Needed to render practice; no guest write path. |
| `rating_params`, `problem_rating_stats`, `player_ratings`, `problem_ratings`, `player_rating_history`, `problem_rating_history` | Public select | Public read | Guest submission rows must never feed rating state. |
| `user_problem_index`, `submission_facts`, `canonical_placements` | Authenticated select | Account only | Hide Progress/history/library-derived personal state from guest routes. Because these are read views, use a JWT-aware view predicate/security-invoker design or a checked RPC rather than assuming a table RLS policy applies to the view. |
| `ai_preferences`, `ai_conversations`, `ai_messages`, `ai_hosted_usage` | Own-row select | Account only | Add restrictive non-anonymous policies. Service-role persistence also requires the shared endpoint guard below. |
| `offline_checkouts`, `offline_package_pages`, `offline_applied_operations`, `offline_client_sessions` | Authenticated reads and narrow delete | Account only | Add restrictive policies; server endpoints and RPCs must reject guests first. |
| `goals` | Own-row CRUD | Account only | Add restrictive policies. |
| `user_onboarding` | Own-row CRUD | Account only | Add restrictive policies. |
| `roadmap_goals` | Public read; admin mutations | Public read / internal mutations | Existing admin check remains; guests cannot receive an admin rank. |
| `roadmap_votes` | Own-row CRUD | Account only | Add restrictive policies. |
| `notifications` | Public/authenticated read; admin mutations | Public read / internal mutations | The route is account-only; retain admin enforcement. |
| `notification_reads` | Own-row select/insert | Account only | Add restrictive policies. |
| `user_submitted_feedback` | Own-row select/insert | Account only | Add restrictive policy; admin review functions also reject anonymous callers. |
| `_import_series`, `_import_tests`, `_import_problems` | Service-role only | Internal | No change. |

The inventory includes every application-owned table or read view in
`supabase/schemas/`. Phase 1 must explicitly review all policies listed above:
an additional permissive owner policy is not an anonymous-user restriction.

## RPC and trigger entry points

| Entry point group | Classification | Phase 1 enforcement / reason |
| --- | --- | --- |
| `claim_profile_username` | Account only | Reject an anonymous JWT inside the security-definer function and in `/auth/complete-profile`. |
| `set_problem_mastery`, `set_problem_engagement` | Account only | They alter long-lived personal classification outside the allowed practice loop. |
| `progress_breakdown`, `problem_state_summary`, `goal_scope_canonicals`, `is_gradeable` | Account only | They expose account-only progress/library/goal capabilities; restrict grants or check non-anonymous status. |
| `goal_set_progress`, `goal_window_progress`, `goal_volume_progress`, `goal_streak_progress`, `set_primary_goal` | Account only | Goals are not available to guests. |
| `offline_checkout_created`, `offline_begin_package`, `offline_finalize_package`, `offline_mark_checkout_ready`, `offline_close_checkout`, `offline_abandon_checkout`, both `offline_sync_v1` overloads | Account only | Reject in each security-definer RPC, as well as the SvelteKit endpoints. |
| `reserve_ai_hosted_turn`, `add_ai_hosted_credits` | Internal | Remain service-role-only; no guest endpoint may reach them. |
| Rating helpers and `admin_recompute_ratings` | Internal / admin only | Preserve service-role/admin checks. Guest rows are excluded by stored provenance, never by current account state. |
| Content-sync, import, recompute-progress, canonical-backfill, and cleanup functions | Internal | Preserve service-role-only grants. |
| Profile, submission, session, rating, and offline triggers | Internal database writers | `handle_new_user` may create a guest profile/root session. Submission triggers add quota and write `rating_eligible = false` for a trusted anonymous JWT. |

## SvelteKit routes and endpoints

| Route family | Classification | Phase 1 boundary |
| --- | --- | --- |
| `/welcome`, `/auth/login`, `/auth/signup` | Public entry | Add the guest entry gesture to the welcome/login surface. A guest must explicitly discard before using ordinary login/signup. |
| `/auth/complete-profile` | Account only | Redirect/reject an anonymous user in load and action; `claim_profile_username` is independently protected in SQL. |
| `/auth/callback` | Account-only completion plus future upgrade callback | Preserve normal login behavior. Phase 2 adds a server-controlled upgrade intent; Phase 1 must not let a guest use the ordinary callback to claim a username. |
| `/practice` | Guest allowed | Guest sees only the root free-practice flow. Block test, review, library launch, offline, and any alternate session path at routing and data-access boundaries. |
| `(app)` routes other than `/practice` — `/`, `/coach`, `/find`, `/goals`, `/history`, `/leaderboard`, `/library`, `/offline`, `/progress`, `/roadmap`, `/settings`, `/usage`, `/whiteboard`, `/help`, `/testing-features` | Account only | Centralize the `User.is_anonymous` route decision in `(app)/+layout.server.ts`, with a `/practice` exception. Hide navigation rather than relying on it. |
| `/admin` | Account only / admin | Retain the existing rank guard and add the non-anonymous route boundary. |
| `/api/ai/*` | Account only | Change shared `requireAIUser` to reject anonymous users with stable `403 account_required` before catalog, hosted allowance, provider, or persistence work. |
| `/api/offline/*` | Account only | Change shared `requireOfflineUser` to reject anonymous users before package, asset, or sync work. |
| `/offline-shell` | Public offline document | It must not acquire a guest-auth dependency. Guests cannot create/sync offline packages. |

## Analytics contract

No analytics provider or event transport is presently installed. Phase 1 must
introduce one deliberately; until then, do not add unconsumed client-side event
calls. These are the required event names and the minimum safe payload. Events
must not contain email, username, answer text, problem statement, full route
query, or raw Supabase user id. `guest_id` is a one-way, analytics-scoped hash
or rotating opaque identifier, never the database UUID.

| Event | Emitted exactly when | Required fields |
| --- | --- | --- |
| `guest_created` | `signInAnonymously()` succeeds | `guest_id`, `entry_surface`, `auth_provider: "anonymous"` |
| `guest_first_problem_shown` | The first root-practice problem is rendered for that guest | `guest_id`, `problem_kind`, `session_kind: "root"` |
| `guest_first_submission` | The first accepted submission insert succeeds | `guest_id`, `outcome` (`correct`, `incorrect`, `skipped`, `ungraded`) |
| `guest_first_solve` | The first accepted correct graded submission succeeds | `guest_id`, `tries_used` bucket |
| `guest_account_prompt_shown` | The first-solve or 25-count prompt becomes visible | `guest_id`, `trigger` (`first_solve`, `submission_25`), `counted_submissions` |
| `guest_account_prompt_dismissed` | The guest explicitly dismisses that prompt | `guest_id`, `trigger`, `counted_submissions` |
| `guest_quota_reached` | The database returns `GUEST_DAILY_QUOTA_EXCEEDED` | `guest_id`, `usage_day`, `counted_submissions: 100` |
| `guest_upgrade_started` | The conversion draft is durably written before email/OAuth linking | `guest_id`, `method` (`email`, `oauth`, `existing_account`) |
| `guest_upgrade_completed` | Identity linking succeeds and the resulting validated user id equals the draft's original user id | `guest_id`, `method` |
| `guest_upgrade_failed` | A linking/verification attempt reaches a terminal failure state | `guest_id`, `method`, `reason` (allowlisted code only) |
| `guest_discard_confirmed` | The guest confirms abandonment before ordinary sign-in | `guest_id`, `destination: "sign_in"` |

Client events are funnel observations, not enforcement evidence. The source of
truth for submission counts and quota rejection is the database. Deduplicate
the three first-* events in browser storage keyed by the guest identity, and
deduplicate backend-observed events using the guest id plus UTC usage day where
applicable.

## Operations ownership and launch gates

| Responsibility | Initial owner | Cadence / evidence |
| --- | --- | --- |
| Anonymous-user cleanup job | Platform/Database on-call | Daily. Select only `auth.users.is_anonymous = true` joined to `profiles.last_active_at < now() - interval '30 days'`; record candidates and deletion totals. |
| Abuse and CAPTCHA/rate-limit monitoring | Security/Platform on-call | Daily during rollout; alert on anonymous sign-in spikes, CAPTCHA failure rate, quota rejections, and request errors. |
| Funnel and conversion reporting | Product/Data owner | Weekly cohort report: creation, first problem, first submission, first solve, quota, upgrade start/completion. |
| Schema/RLS and endpoint authorization review | Backend owner | Required before enabling anonymous sign-ins in any environment; include direct Data API/RPC tests for every Account only row above. |

Before enabling Phase 1 outside development, the role owners must be mapped to named people and alert destinations in the deployment runbook. This document does not authorize changing `enable_anonymous_sign_ins`; that remains a Phase 1 change after the direct-access test suite exists.
