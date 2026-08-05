# AI Coach — Sessions, Context & Tools

> **Status: Phases 0–1 shipped; §2–§6 are the target state, not yet built.** This is
> the authoritative explainer for how Coach conversations are anchored,
> persisted, and fed context. Phases land incrementally (§8, which marks what has
> shipped); `CLAUDE.md` is updated as each one ships, so until a phase is marked
> done the code is still the old model described in §7.

The BYOK rule from `CLAUDE.md` is unchanged and overrides anything here: **a
user's own key never leaves their browser.** Everything below is compatible with
requests going straight from the browser to the provider.

---

## 1. The three tiers

Every Coach conversation is one of three tiers. The tier is decided by *where the
Coach was summoned and whether it was escalated*, never by a user-facing toggle.

The tier itself lives in `$lib/ai/session/tier.ts` (pure) and on `coach.tier`; a
surface that owns a thread declares itself with `coach.present("panel" | "inline")`,
which is the only thing that promotes a one-shot.

| | **Work** | **Assist** | **One-shot** |
| --- | --- | --- | --- |
| Example | Coaching on AMC 10A #18 in the trainer | "what should I review?", "find that cyclic-quadrilateral problem" | Library query bar; a quick-ask that was never escalated |
| Anchored to | one problem in one practice session | nothing | nothing |
| Persisted | yes | yes | **never — no DB row exists** |
| Auto-resumed | **yes, by prompt** (§2 index, §5 rule) | no — new thread each open, history one click away | n/a |
| Context style | **context-heavy, tool-light** | **context-light, tool-heavy** | tool-only |
| Retention | archived on conclusion (§5), then browsable | `ai_preferences.retention_days` | n/a |

### Why the split exists

The two families need *different delivery mechanisms*, not just different
prompts:

- **Content context** (problem, test, series) is finite, cacheable, resolvable
  from an id, and sitting in front of the user. It is **injected**.
- **User context** (progress, stats, submission history, settings) is unbounded
  and always changing. It is **fetched by tool**, on demand.

"What have I not done in scope xyz" cannot be served by stuffing a system prompt;
it needs `search_problems()`. This is why today's `AIContextMode` and `AITaskType`
are dead code — there was no tool layer for them to route to.

A thin `UserProfileFact` (rating, active session, recent topics — a few hundred
tokens) is injected on every tier. Anything deeper is a tool call.

### Promotion

A one-shot holds its transcript **in memory only**. Escalating a quick-ask to the
panel or the trainer flushes that transcript to the server in a single request
(`POST /api/ai/conversations`), creating the conversation with the turns it
already has.

This works only because **the client mints the conversation UUID up front**.
Promotion is a flush, not an id negotiation. There is no assist → work promotion
(decided 2026-08-05): starting practice from an assist thread opens a *new* work
thread for the problem and leaves the assist thread alone. Nothing demotes a
persisted thread back into memory either — it already has rows.

Escalating **mid-stream** defers the flush until the turn finishes: the in-flight
turn captured no conversation id, so that flush is the only thing that will ever
save it, and firing early would store a half-written answer. Like every other
write on this path, the flush is best-effort — a failed one costs the user the
earlier turns of the thread, never the thread itself, because the id was minted
at promotion and the next send writes into the same conversation.

---

## 2. Schema

Only `ai_conversations` and `ai_messages` change. Declarative source of truth is
`supabase/schemas/ai_coach.sql`; use the CLI diff/migration flow, then regenerate
`src/lib/types/database.types.ts`.

```sql
alter table public.ai_conversations
  -- Which family this thread belongs to. Drives resume behavior and retention.
  add column kind text not null default 'assist'
    check (kind in ('work', 'assist')),

  -- What a work thread is about. Set when kind = 'work', null for assist.
  -- `set null`, not `cascade`: §3 wants a deleted problem to resolve into a
  -- degraded fact the renderer can explain. Cascade would take the user's own
  -- writing with it before anything had a chance to degrade.
  add column problem_id bigint references public.problems(id) on delete set null,

  -- Which sitting. This is what makes "resume the same attempt" mean something:
  -- the same problem in a NEW practice session is a NEW thread, not the old one.
  -- Deliberately NOT an FK — an opaque sitting discriminator. Users may delete
  -- their own practice sessions (practice_sessions.sql grants delete), and an FK
  -- would either cascade away the chat history or, under `set null`, make the
  -- delete fail against the partial unique index below. A dangling id is
  -- harmless: the anchor is only ever looked up while that session is live.
  add column practice_session_id bigint,

  -- Retention + staleness, without overloading updated_at. Also drives the
  -- resumability cutoff in §5.
  add column last_active_at timestamptz not null default now();

alter table public.ai_messages
  -- The facts that were live when this turn was sent (§3).
  add column context_snapshot jsonb not null default '[]'::jsonb;
```

The one index that implements "you have an existing session — continue or new?":

```sql
create unique index ai_conversations_work_anchor_idx
  on public.ai_conversations (user_id, problem_id, practice_session_id)
  nulls not distinct
  where kind = 'work' and archived_at is null
    and problem_id is not null;
```

Both extra clauses are load-bearing:

- **`nulls not distinct`** (PG 15+). Postgres treats NULLs as *distinct* in a
  unique index by default, so without it "this problem, no practice session"
  would admit unlimited live threads instead of one — the exact case the index
  exists to bound.
- **`problem_id is not null`** is what makes `on delete set null` safe above.
  Threads orphaned by a problem delete fall out of the index (so two different
  deleted problems don't collide on `(user, null, session)`) and never match the
  resume lookup — correct, since there is no longer an anchor to resume onto.

**At most one live work thread per (user, problem, practice session).** The
resume prompt is a UI consequence of this constraint, not a separate mechanism:

- Trainer loads problem X in session S → look up that row.
  - Found and resumable (§5) → prompt "continue or start new chat".
  - Not found → no prompt, blank Coach.
- **Continue** → attach to it.
- **New chat** → `archived_at = now()` on the old row (releasing the partial
  index), insert a fresh one. The old thread stays in history.

Assist threads have null anchors, so the partial index ignores them — a user may
have any number.

`problem_id` anchors on the **canonical** row (`coalesce(canonical_id, id)`), for
the same reason submissions do: an alias placement must not fork the thread.

Three things that are easy to get wrong here:

- **Who writes `last_active_at`.** The same server-side write that saves a turn
  (`POST /api/ai/messages`, and the promotion flush) bumps it; nothing else
  touches it. Set only at creation, it would make §5's `idleMs` measure a
  thread's *age* rather than its idleness, and a thread the student worked in all
  afternoon would read as stale.
- **There is deliberately no `check (kind <> 'work' or problem_id is not null)`.**
  It looks like the obvious integrity constraint and it would break the delete
  path: `on delete set null` above produces exactly that state on purpose, so the
  check would make deleting a problem fail. Work-ness is carried by `kind`; the
  anchor is nullable by design.
- **An anchor collision raises, it does not silently fork.** `ensureConversation`
  upserts `on conflict (id) do nothing`, which says nothing about
  `ai_conversations_work_anchor_idx` — so two tabs opening the same problem in
  the same sitting produce a `23505` on the loser rather than a swallowed insert.
  The resume flow has to catch it, re-read the anchor row, and attach: the same
  "continue" branch above, reached from a lost race instead of a prompt.

### What phase 3 removes

Two `ai_conversations` columns are superseded and must actually be dropped, or
the app carries two disagreeing records of the same thing:

```sql
alter table public.ai_conversations
  -- Written as a hardcoded 'general' on every insert (persistence.ts,
  -- ensureConversation) and read by nothing. `kind` (§2) plus the §3 policy are
  -- what it was reaching for.
  drop column mode,
  -- A CONVERSATION-level context snapshot, written once at creation. §3 replaces
  -- it with a per-TURN context_snapshot, which is strictly more correct: a thread
  -- that moves between problems is exactly the case this column gets wrong.
  drop column context_summary;
```

Both drops are the last step of phase 3, after `context_snapshot` is being
written — not the first, so a half-deployed phase never has neither.

### Why messages stay their own table (decided 2026-08-05)

The tempting simplification is to delete `ai_messages` and keep the transcript as
one jsonb array on `ai_conversations`: no join, no migration to add per-turn
metadata, one row per thread instead of thousands. It is the wrong trade here,
for reasons that are about *append*, not about size:

- **Every append rewrites the whole transcript.** Postgres has no partial update
  for jsonb, so adding turn 40 writes a new row version containing turns 1–40,
  and TOASTs it again. Appending is O(n) per turn and O(n²) per conversation, and
  the dead tuples land on autovacuum. A row insert costs the size of one turn,
  forever.
- **Streaming makes it worse, not better.** `ai_messages.status` moves
  `streaming → complete`, so a status flip rewrites the blob a second time.
- **It breaks the idempotency invariant.** Client-minted message ids +
  `on conflict do nothing` is what makes a retried save safe (phase 0, and
  `CLAUDE.md`). An array has no unique constraint to conflict against: a retry
  becomes read-modify-write, and two tabs racing silently lose a turn.
- **Every read becomes a whole-thread read.** History lists and bounded replays
  are `order by created_at limit n` against rows; against a blob there is no
  such thing as reading part of it. Phase 1 deliberately removed the unbounded
  bootstrap transcript — a blob column reintroduces it structurally.
- **Retention** (`retention_days`) is a ranged delete over rows, versus rewriting
  every surviving conversation.

Row count is not the problem it looks like: a heavy user at 50 turns/day is ~18k
rows a year, and the table is one narrow index. The blob does not store fewer
bytes than the rows do — it stores the same bytes in a shape that has to be
rewritten to grow.

**The real concern behind the idea — "I don't want a migration every time a turn
needs a new field" — is already solved,** and not by dropping the table.
`content_parts` and `context_snapshot` are jsonb *inside* the row: the structural,
queryable, constraint-bearing fields (id, conversation, role, status, timestamp)
are columns, and the evolving payload is jsonb next to them. New per-turn metadata
goes inside the jsonb with no migration at all. That is the same hybrid, with the
append and idempotency properties kept.

Note the wire format is already the shape the idea wants: a promoted one-shot
flushes its whole transcript in one `POST /api/ai/conversations` (§1). Sending a
transcript as one blob and storing it as one blob are independent choices.

### Column or jsonb

The rule that produced the shapes above, stated once so it doesn't get
re-litigated per field: **a column is for what the database enforces, indexes, or
joins on; jsonb is for payload the database only stores and hands back.**

That is why the anchor stays five typed columns rather than one `anchor jsonb`.
Every one of them is something the DB acts on — `problem_id` and
`practice_session_id` are index keys, `kind` is a CHECK plus the index predicate,
`last_active_at` is a ranged scan for retention, and both id columns carry FKs.
Moving them into jsonb costs, worst first: **FKs become impossible** (Postgres has
no FK out of a jsonb field, and the index's `problem_id is not null` clause
depends on `on delete set null` firing); `->>` yields **text**, so `12345` and
`"12345"` are distinct index entries and a client that stringifies an id gets a
second live thread for the same problem — precisely the bug the index exists to
prevent. It is not even smaller: four fixed-width, aligned values beat a jsonb
object that repeats its key names in every row.

`ai_messages` has three jsonb columns for the mirror-image reason, and the count
is not the smell — one jsonb doing three jobs would be. They differ in lifecycle
and nullability, which is exactly why they are separate: `content_parts` is
`not null` and mutates while streaming, `usage_summary` is **nullable** and
written once at completion (null on failed/cancelled), `context_snapshot` is
`not null` and never changes after the send. Merged, the usage write at
completion would rewrite the content too.

**`usage_summary` is the one to watch.** It is really 2–3 integers, jsonb only
because BYOK providers report usage in different shapes and it is absent on
failure. If usage reporting ever ships, summing a jsonb field across a month is
un-indexable and awkward — at that point `input_tokens` / `output_tokens` become
columns and the provider-specific remainder stays in jsonb.

The split is the design, not an accident: `ai_conversations` is the *queried*
table (enforce one-per-anchor, list my threads, expire old ones), so nearly
everything on it is indexed or constrained. `ai_messages` is the *append-only
log*, structural fields only — id, conversation, role, status, created_at — and
the rest payload. `practice_sessions` already makes the same call the same way:
an opaque `settings jsonb` snapshot sitting next to a typed
`current_problem_id bigint references problems(id) on delete set null`.

---

## 3. Context as typed facts

Context descriptors stop being a `label` + prose blob and become a discriminated
union. Surfaces publish *facts*; one renderer decides what the model sees.

```
$lib/ai/context/
  facts.ts     ProblemFact | TestFact | SeriesFact | AttemptFact | UserProfileFact
  resolve.ts   {kind, id} → fact, browser-side, from the library store
  render.ts    fact[] + policy → prompt sections (budgeted, deterministic)
  policy.ts    'coaching' | 'test-locked' | 'assist' — what may be shown and said
  registry.ts  the layer stack (today's context-stack.ts, unchanged)
```

Two consequences worth stating plainly:

- **`AttemptFact` is what makes coaching possible.** It carries the submitted
  answer, tries used, and submitted/revealed state. Without it the Coach cannot
  say "your 42 came from dropping the factor of 2" — it can only lecture. Today
  the trainer sends statement + choices and nothing else.
- **`policy` is what `AIContextMode` was always meant to be.** Under
  `test-locked` the same renderer omits the answer key and the prompt forbids
  full solutions. The policy is enforced at the render seam, so no surface can
  forget it.

### Three layers: reference, resolved, rendered

```ts
// 1. REFERENCE — small and stable. Travels on the wire; the ONLY form stored.
type FactRef =
    | { kind: "problem"; id: number }
    | { kind: "attempt"; problemId: number; answer: string | null;
        triesUsed: number; submitted: boolean; revealed: boolean; elapsedMs: number }
    | { kind: "selection"; text: string };

// 2. RESOLVED — the real content, fetched at runtime. Never stored.
//    NOTE: no `solution`. The worked solution is never injected; it is reached
//    through get_solution (§6) so it enters the thread only when earned.
interface ProblemFact {
    kind: "problem"; id: number;
    statement: string; choices: string[] | null; answer: string | null;
    topic: string; source: string; rating: number | null;
    warnings: FactWarning[];
}

// 3. RENDERED — prompt text. A pure function per kind. Never stored.
function renderProblem(fact: ProblemFact, policy: Policy): string;
```

### Snapshots — reference what can be re-derived, store what cannot

`ai_messages.context_snapshot` stores **references**, not rendered prose. Per
user turn it holds something like
`[{kind:"problem",id:12345},{kind:"attempt",…}]` — a few dozen bytes. The
resolve → render pipeline runs on **every** turn, including replays of old ones.

The rule: **snapshot what cannot be re-derived, reference what can.** A problem
is always re-fetchable by id, so only its id is kept. An in-progress attempt
(the answer typed but not submitted, tries burned) exists nowhere else once the
trainer's memory is gone, so its values are kept.

This is what makes context correctable at runtime:

- **Format changes propagate everywhere.** One pure function per kind, so
  editing it changes new turns, replayed history, and every surface at once —
  and the invariants become testable
  (`expect(render(fact, "test-locked")).not.toContain(fact.answer)`).
- **Content corrections heal old threads.** Fix a wrong solution in `problems`
  and the next turn of a three-week-old thread resolves the corrected text. Had
  the rendered prose been stored, every old thread would repeat the error
  forever.
- **Errors surface instead of hiding.** The resolver returns a *degraded* fact
  rather than throwing, and the renderer states the degradation: a deleted
  problem, an `answer_status = 'source_missing'` answer, or a **pending
  `user_submitted_feedback` row of `type = 'problem_report'`** — which resolves
  into "this problem's answer has been reported as incorrect (suggested: C);
  treat it as unverified" rather than letting the Coach assert a wrong answer.

**Trade-off:** live re-rendering gives up exact reproducibility — you cannot
later prove what the model saw before a correction landed. That is accepted, not
mitigated: no renderer version is stamped on the snapshot. Healing old threads is
worth more than being able to audit them, and a version integer only tells you
*which* renderer ran, never what it produced.

Without snapshots at all, reloading a thread hands the model a transcript about
a problem it can no longer see, and a thread spanning several problems shows
only the newest one while the turns refer to all of them.

---

## 4. Anchors

```ts
// $lib/ai/session/anchor.ts
export interface WorkAnchor {
    problemId: number;          // canonical
    practiceSessionId: number | null;
}
```

`practiceSessionId` is null only for library work — practice always has a
session, since every user has an always-present root one (`practice_sessions.is_root`).
Null is a *single* slot rather than unlimited ones because the index is
`nulls not distinct` (§2).

### The anchor is the sitting, not the attempt (decided 2026-08-05)

An attempt cannot be the anchor, because when the thread opens it does not exist
yet. The trainer writes exactly **one** `submissions` row, at the *end* of the
sitting — a "wrong, wrong, right" struggle is a single row written after the
struggle is over (`docs/attempt-concepts.md` §1) — and an abandoned problem
writes none at all. An FK to `submissions` would therefore be null for the entire
life of the thread. `encounter` / `attempt` are no better: they are trigger-set
annotations derived from the *previous* graded row, not keys anything can address
up front.

So `(problem_id, practice_session_id)` is the best **pre-hoc approximation of an
encounter**, and it is only an approximation. The two disagree in both directions:

- one practice session, 45 minutes on one problem with a break in the middle →
  **one** anchor, **two** encounters (`rating_params.encounter_gap`, default 30 min);
- the root session never ends, so problem X worked today and again next week is
  **one** anchor slot but two encounters. This is why §5 needs a staleness cutoff.

Attempt state does have two homes, both narrower than the anchor:

- **Per turn**, as §3's `AttemptFact` — the answer typed but not submitted, tries
  burned, elapsed time. Those exist nowhere else once the trainer's memory is
  gone, and message grain is the right grain for them.
- **One nullable back-pointer at conclusion**, which is the only thing that buys
  the reverse lookup ("open the Coach chat from when I got this wrong", from the
  history/review screen):
  `concluded_submission_id bigint references public.submissions(id) on delete set null`.
  Deferred to phase 3: `recordSubmission` (`src/lib/progress.ts`) returns `void`
  today and would need `.select("id").single()`. Best-effort like every other
  write on this path.

### No link table (decided 2026-08-05)

The conversation-level anchor is single-valued by definition — a work thread has
exactly one, an assist thread has none — and single-valued means a column.

The many-to-many case (a thread that wanders across several problems) is already
solved one level down, by §3's per-message `context_snapshot` refs. An
`ai_conversation_problems` table would duplicate that *and* lose information: it
could not say which turn was about which problem.

The only thing such a table would add is the fast reverse query "every thread
touching problem X". If that ever becomes a product surface, the answer is still
not a hand-maintained link table but a **derived projection** — the same shape as
`problem_progress` folding `submissions`: either a GIN index on
`context_snapshot` (`jsonb_path_ops`), or a trigger-maintained
`ai_message_facts(message_id, conversation_id, kind, ref_id)`. Deferred until a
surface actually needs it.

---

## 5. Work-thread lifecycle

Deliberately a pure, isolated module: the rule is expected to change.

```ts
// $lib/ai/session/lifecycle.ts
export interface WorkAnchorState {
    submitted: boolean;
    revealed: boolean;
    skipped: boolean;
    leftAnchor: boolean;
    idleMs: number;   // now - last_active_at
}

/** How long an unconcluded thread stays offerable. Tuning knob, not a rule. */
export const WORK_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** Has the work this thread was opened for concluded? v1: submitting concludes it. */
export function workConcluded(s: WorkAnchorState): boolean {
    return s.submitted;
}

/** May the thread be resumed if the user returns to the anchor? Drives the prompt. */
export function workResumable(s: WorkAnchorState): boolean {
    return !workConcluded(s) && s.idleMs < WORK_STALE_AFTER_MS;
}

/** When the row is actually archived — freeing the unique index slot. */
export function workArchivable(s: WorkAnchorState): boolean {
    return workConcluded(s) && s.leftAnchor;
}
```

**`skipped` and `revealed` are carried but unused — resolve that before phase 2
ships.** As written, `workConcluded` reads only `submitted`, which leaves a
skipped problem's thread live and holding its index slot until staleness or a
return visit clears it. A skip writes a real `submissions` row and is an explicit
"I'm done with this", so it should probably conclude the work too
(`return s.submitted || s.skipped`). `revealed` is doing nothing here at all — it
belongs to §6's `get_solution` gate, not the lifecycle. Either wire them in or
drop them from the interface; a spec field that no function reads is a promise
the code isn't keeping.

**Staleness is why `workResumable` is not just `!workConcluded`.** A thread
abandoned without submitting never concludes, so without a cutoff it stays
resumable forever — and per §4 the root session would then offer "continue or
start new?" over a week-old thread the user has entirely forgotten. Staleness
only suppresses the *prompt*: the row is still live and still in history, and
taking the fresh thread archives it through the same `archived_at = now()` path
as an explicit "new chat" (§2), releasing the index slot.

**Concluded ≠ archived, on purpose.** Submitting a wrong answer is the moment a
student most wants to ask "why?" — so the thread stays live and writable while
they remain on the problem, and is archived only when they move on. Returning to
the problem later therefore starts clean, and the old discussion is still in
history.

---

## 6. Tools

```
$lib/ai/tools/
  registry.ts   name → { schema, consequence, policy gate, run }
  problem.ts    get_solution
  library.ts    search_problems, get_problem
  progress.ts   get_progress, get_weak_topics
```

**Read-only first** (decided 2026-08-05). Every v1 tool has
`consequence: "read"` and runs automatically. Write tools
(`create_practice_session`) wait until the confirmation flow exists — the
machinery is already stubbed (`AIToolPart` carries `proposed`/`confirmed`, and
the mock provider emits both), it is simply unused.

Once tools exist, `AITaskType` stops being a constant: it is derived from the
tier's policy plus the selected model's capabilities, and `resolveModel`'s
`task === "agentic"` capability filter finally engages.

### `get_solution` — why the worked solution is a tool, not context

Injecting the full solution makes the Coach far better at diagnosing a specific
wrong turn, and far likelier to hand over the whole thing when the student
wanted a nudge. As a tool it enters the thread only when the conversation has
earned it. Four consequences:

- **Tools are policy-gated, not global.** `toolsFor(policy)` decides what the
  model is even offered. Under `test-locked`, `get_solution` is not in the list
  — the same enforcement seam that makes the renderer omit the answer. It is
  auto-allowed once `AttemptFact.revealed || .submitted`, since gating a
  solution the student has already been shown is theatre.
- **The user-initiated path needs no tool support.** A "walk me through the full
  solution" quick action attaches a `SolutionFact` to that one turn. Model-
  initiated (`get_solution`) and user-initiated (quick action) resolve the same
  fact and render through the same function — one code path, two triggers. This
  is also the fallback for BYOK models with no tool calling, which would
  otherwise lose solution access entirely.
- **Read-only tools are replayable, which is what keeps history correct.**
  `AIToolPart` stores the call (`{tool, args}`), not the payload, and the result
  is re-resolved on replay — the same "reference what can be re-derived" rule as
  §3, so a corrected solution heals old threads too. Write tools cannot work
  this way (you cannot re-run `create_practice_session`) and will need stored
  results. This is a second, independent reason read-only comes first.
- **Revelation is sticky within a thread, by construction.** The tool call sits
  in the transcript, so later turns still see it. Once revealed, revealed.

---

## 7. What this replaces

For reviewers comparing against the code as of 2026-08-05. Locations are given as
file + symbol on purpose — line numbers in this table had already drifted once by
the time phases 0–1 shipped.

| Current behavior | Where | Replaced by |
| --- | --- | --- |
| Context injected into the current system prompt only; never durable | `prompt.ts` `buildSystemMessage`, and `ai_messages` has no context column | §3 snapshots |
| Trainer sends statement + choices; no answer, no attempt state | `PracticeView.svelte` `coachProblemText` | §3 `AttemptFact` |
| `CoachContextLayer.mode` consumed by nothing | only validated, `schemas.ts` `parseContextLayer` | §3 policy |
| `ai_conversations.mode` hardcoded `'general'`; `context_summary` snapshots context per *conversation* | `persistence.ts` `ensureConversation` | §2 `kind` + §3 per-turn `context_snapshot`; both columns dropped in phase 3 |
| `task` hardcoded `"general"` on both send paths | `coach.svelte.ts`, server and BYOK sends | §6 |
| Bootstrap always resumes the newest thread, entire transcript unbounded | `persistence.ts` `messagesFor` | **✅ Phase 1** — bootstrap carries no transcript at all; assist opens fresh and history is one click away |
| Every conversation is written down, including a throwaway quick-ask | `chat/+server.ts`, `coach.svelte.ts` | **✅ Phase 1** — a one-shot mints no id and sends `persist: false`; no row exists until it is escalated |
| BYOK learns its `conversationId` only after a best-effort write; a failed write silently splits the thread | `coach.svelte.ts` `#ensureConversationId` | **✅ Phase 0** — minted before the first token |
| `newConversation()` mid-stream re-creates a thread from the aborted turn | `coach.svelte.ts` send paths | **✅ Phase 0** — `{conversationId, generation}` captured at send start, persistence generation-guarded |
| Memory message ids ≠ DB ids; no idempotency on save | `messages/+server.ts` | **✅ Phase 0** — client-supplied ids + `on conflict do nothing` |
| `default_model` written at signup, never again | `preferences/+server.ts` PATCH | **✅ Phase 0** — PATCH is a patch; the `selectedModel` setter persists |
| `retention_days` stored, enforced by nothing | — | retention job |

---

## 8. Phases

Each phase is independently shippable and leaves the app working.

| # | Scope | Schema? |
| --- | --- | --- |
| **0** ✅ | Correctness only: capture `{conversationId, generation}` at send start; client-minted conversation + message ids; idempotent saves; persist `defaultModel`; bound the bootstrap transcript (bounding since superseded — Phase 1 removed the bootstrap transcript outright) | no |
| **1** ✅ | Tiers (§1): `persist` tier on the session, quick-ask holds in memory, flush-on-escalate, assist threads stop auto-resuming | no |
| **2** | Anchors + lifecycle (§2, §4, §5): the four columns, the unique index, the staleness cutoff, the "continue or new?" prompt | **yes** |
| **3** | Typed facts, policy, snapshots (§3); the `concluded_submission_id` back-pointer (§4); drop the superseded `mode` / `context_summary` (§2) | **yes** — `+context_snapshot`, `+concluded_submission_id`, `−mode`, `−context_summary` |
| **4** | Read-only tools (§6); `task` derived rather than constant | no |
| **5** | Split `CoachStore` into session / transport / recorder / history / presence | no |

Phase 5 is last on purpose: the split is mechanical once the seams above are
real, and doing it first would mean moving code twice.
