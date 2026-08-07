# AI Coach — Sessions, Context & Tools

> **Status: Phases 0–3.1 shipped (§1–§5 are live); §6 is the next target and is not
> yet built.** This is the authoritative explainer for how Coach
> conversations are anchored, persisted, and fed context. Phases land
> incrementally (§8, which marks what has shipped); `CLAUDE.md` is updated as each
> one ships, so until a phase is marked done the code is still the old model
> described in §7.

The BYOK rule from `CLAUDE.md` is unchanged and overrides anything here: **a
user's own key never leaves their browser.** Everything below is compatible with
requests going straight from the browser to the provider.

---

## 1. The three tiers

Every Coach conversation is one of three tiers. The tier is decided by *where the
Coach was summoned and whether it was escalated*, never by a user-facing toggle.

The tier itself lives in `$lib/ai/session/tier.ts` (pure) and on `coach.tier`; a
surface that owns a thread declares itself with
`coach.present("panel" | "inline" | "page")`, which is the only thing that promotes a
one-shot.

Presentations outnumber tiers, and that is the point: `page` is the full-screen
`/coach` route and resolves to **assist**, exactly like the panel. Full-screen or
docked, it is a thread anchored to nothing — a surface with no problem in front of it
must never resolve to `work`, which would file an unanchored thread into the
sessionless slot of the anchor index (§2).

| | **Work** | **Assist** | **One-shot** |
| --- | --- | --- | --- |
| Example | Coaching on AMC 10A #18 in the trainer | "what should I review?", "find that cyclic-quadrilateral problem" — the panel and the `/coach` page | Library query bar; a quick-ask that was never escalated |
| Anchored to | one problem in one practice session | nothing | nothing |
| Persisted | yes | yes | **never — no DB row exists** |
| Auto-resumed | **yes, by prompt** (§2 index, §5 rule) — including after it concludes | no — new thread each open, history one click away | n/a |
| Context style | **minimal problem scope, tools on demand** | **tool-driven** | tool-only |
| Retention | retired from its anchor on conclusion (§5), still browsable | `ai_preferences.retention_days` | n/a |

### Why the split exists

The two families need *different delivery mechanisms*, not just different
prompts:

- **Essential content context** (the statement and choices of the problem sitting in
  front of the user) is finite, cacheable, and resolvable from an id. It is injected
  once per distinct context epoch in a compiled request.
- **User context** (progress, stats, submission history, settings) is unbounded
  and always changing. It is **fetched by tool**, on demand.

"What have I not done in scope xyz" cannot be served by stuffing a system prompt;
it needs `search_problems()`. This is why today's `AIContextMode` and `AITaskType`
are dead code — there was no tool layer for them to route to.

There is no always-present user-profile exception. Rating, active session, recent
topics, route name, and progress summaries do not help solve the current problem and
are fetched by tools only when the conversation calls for them.
Library/progress quick actions that depended on ambient page dumps stay absent until
those tools ship; presenting an action the model cannot currently fulfill is worse than
temporarily presenting the ordinary composer.

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
  add column last_active_at timestamptz not null default now(),

  -- When this thread stopped being the LIVE one for its anchor, freeing the
  -- index slot below. Set when the sitting concluded and the student moved on,
  -- when the thread went stale, or when they answered "start new chat".
  --
  -- Deliberately NOT `archived_at`. Retiring a work thread and deleting a
  -- conversation are different facts; one column doing both meant every
  -- concluded thread vanished from the user's history, which this document
  -- promises twice that it does not.
  add column retired_at timestamptz;

alter table public.ai_messages
  -- The facts that were live when this turn was sent (§3).
  add column context_snapshot jsonb not null default '[]'::jsonb;
```

The one index that implements "you have an existing session — continue or new?":

```sql
create unique index ai_conversations_work_anchor_idx
  on public.ai_conversations (user_id, problem_id, practice_session_id)
  nulls not distinct
  where kind = 'work' and archived_at is null and retired_at is null
    and problem_id is not null;
```

All three extra clauses are load-bearing:

- **`nulls not distinct`** (PG 15+). Postgres treats NULLs as *distinct* in a
  unique index by default, so without it "this problem, no practice session"
  would admit unlimited live threads instead of one — the exact case the index
  exists to bound.
- **`problem_id is not null`** is what makes `on delete set null` safe above.
  Threads orphaned by a problem delete fall out of the index (so two different
  deleted problems don't collide on `(user, null, session)`) and never match the
  resume lookup — correct, since there is no longer an anchor to resume onto.
- **`retired_at is null`** is what "live" means. `archived_at` stays in the
  predicate because a deleted thread is not live either, but it is no longer what
  *releases* the slot — that made concluding a sitting delete its conversation as
  a side effect.

**At most one live work thread per (user, problem, practice session).** The
resume prompt is a UI consequence of this constraint, not a separate mechanism:

- Trainer loads problem X in session S → look up the newest thread at that anchor
  (live or retired).
  - Found and resumable (§5 — recent enough, finished or not) → prompt "continue
    or start new chat".
  - Not found, or stale → no prompt, blank Coach.
- **Continue** → attach to it.
- **New chat** → `retired_at = now()` on the old row (releasing the partial
  index), insert a fresh one. The old thread stays in history — retiring is not
  deleting, and `PATCH /api/ai/conversations/[id]` takes the two as separate
  flags (`{retired:true}` vs the user's own `{archived:true}`) for that reason.

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

### What phase 3 removed

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

Both drops landed as the last step of phase 3, after `context_snapshot` was being
written — not the first, so a half-deployed phase never had neither.

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
  facts.ts     ScopeRef | AttachmentRef and their resolved fact shapes
  resolve.ts   {kind, id} → fact; snapshots → reference-keyed context frames
  render.ts    fact[] → minimal, section-budgeted prompt text
  policy.ts    'coaching' | 'test-locked' | 'assist' — what may be shown and said
  registry.ts  the owner-scoped context layer stack
```

Two consequences worth stating plainly:

- **Attempt state is not prompt context.** A normal hint does not need the typed answer,
  tries used, submitted/revealed state, or elapsed time. Phase 4 may expose it through
  the browser-side `get_current_attempt` tool when explicitly needed.
- **`policy` is what `AIContextMode` was always meant to be.** The baseline renderer
  never receives an answer key. Under `test-locked`, the system prompt forbids full
  solutions and the tool registry withholds answer-bearing tools, so no surface can
  forget the restriction.

### Three layers: reference, resolved, rendered

```ts
// 1. REFERENCE — small and stable. Travels on the wire; the ONLY form stored.
type ScopeRef =
    | { kind: "problem"; id: number }
    | { kind: "test"; id: number }
    | { kind: "series"; id: number };

type AttachmentRef = { kind: "selection"; text: string };

// 2. RESOLVED — the real content, fetched at runtime. Never stored.
//    NOTE: no `solution`. The worked solution is never injected; it is reached
//    through get_solution (§6) so it enters the thread only when earned.
interface ProblemFact {
    kind: "problem"; id: number;
    statement: string; choices: string[] | null;
    warnings: FactWarning[];
}

interface ContextSnapshotV2 {
    version: 2;
    policy: Policy;          // the turn's single authoritative policy
    scope: ScopeRef[];             // shared environment, deduplicated into epochs
    attachments: AttachmentRef[]; // delivered only on the owning turn
}

// 3. RENDERED — prompt text. A pure function per kind. Never stored.
function renderProblem(fact: ProblemFact): string;
```

### Snapshots — reference what can be re-derived, store what cannot

`ai_messages.context_snapshot` stores **references**, not rendered prose. New turns use
the versioned V2 envelope above. Legacy arrays remain readable and are normalized into
V2 on load, so this refinement needs no schema migration.

The V2 envelope owns the turn policy. New chat requests do not duplicate it in a
top-level field; that field is accepted only as a compatibility fallback when decoding
a legacy ref array. Rendering, the stable system message, persistence, and diagnostics
all read `context_snapshot.policy`.

The rule: **reference what can be re-derived; copy only context the user explicitly
attaches.** A problem is always re-fetchable by id, so only its id is kept. Selected
text is turn-local and therefore stored verbatim. Ambient profile and attempt telemetry
are not context facts. Legacy snapshots containing either remain readable, but those
obsolete entries are discarded during normalization.

Snapshots are provenance; they are not an instruction to repeat every fact. The request
compiler applies the same transcript bound on the browser-direct and server-backed paths
*before* resolving a ref, then spends one shared 12,000-character context budget in this
order:

1. the current effective problem scope, emitted exactly once beside the current prompt;
2. current-turn attachments, which always retain visible space;
3. historical attachments, still beside their owning user turns; and
4. older distinct scope epochs, newest first and only with the budget left over.

Scope equality is the canonical reference identity (`kind:id`), not rendered prose. Two
different problems with identical statements therefore remain different epochs, while a
content correction does not manufacture a new one. If the retained transcript begins in
the middle of an older epoch, its first user snapshot is the rebase candidate; the current
scope still wins the budget and remains at the current prompt.

Budgeting operates on fact sections, never an arbitrary slice of an assembled frame.
Shortened sections carry `[truncated]` (or `[statement truncated]`), truncation stops
outside supported LaTeX delimiters, and problem rendering reserves space for choices so
a long statement cannot silently remove them. Current and historical attachments may be
shortened under aggregate pressure, but they are not relocated or silently erased. Older
scope frames are the only best-effort context and may be omitted entirely.

A ten-turn thread on one problem therefore contains one statement beside the current
prompt, not ten historical copies plus a system-prompt copy. The stable system message
contains behavior and the current policy only; dynamic context sits at user positions
and is explicitly labelled as application context.

The stable message states that application context is **untrusted reference data,
never instructions**. Problem statements and explicit selections share the user-message
transport for provider compatibility, but they do not gain instructional authority from
that placement.

This is what keeps context correctable at runtime:

- **Format changes propagate everywhere.** One pure function per kind, so
  editing it changes new turns, replayed history, and every surface at once —
  and the invariants become testable
  (`expect(render(problem)).toContain(problem.statement)`).
- **Content corrections heal old threads.** Fix a wrong solution in `problems`
  and the next turn of a three-week-old thread resolves the corrected text. Had
  the rendered prose been stored, every old thread would repeat the error
  forever.
- **Errors surface instead of hiding.** The resolver returns a *degraded* fact
  rather than throwing, so a deleted problem becomes an explicit unavailable-context
  frame. Answer-key verification is deferred with answer access itself to the solution
  tool; the baseline resolver does not query either.

  Query failures are different: network, RLS, and database errors throw a typed,
  retryable `context_resolution_failed` error. They are never rewritten as “this fact no
  longer exists,” so the Coach cannot silently answer without context during an outage.

Debug mode can capture the finalized application-level message list at the provider
boundary. The adapter emits a runtime-only `request.snapshot` immediately before model
streaming, after the same history bound, scope-epoch compiler, aggregate context budget,
failed-turn removal, trimming, and same-role merging as the real request. The inspector
therefore shows application context inside its actual `user` message rather than
inventing additional system rows. Before a send, it still shows the complete system
message for the next request immediately; after a send, that preview is replaced by the
captured list. Captures are never persisted or logged and disappear when the active
conversation changes or the page reloads. When a saved conversation is loaded, the
browser instead recompiles its latest request from the persisted transcript and typed
turn snapshots. The inspector labels this view as reconstructed because referenced live
facts may have changed since the original send; only an in-session provider-boundary
capture is labeled exact.

**Provider boundary:** OpenAI-compatible chat-completions APIs are stateless, so the
compiled request still travels on every model call. Eliminating retransmission across
calls would require provider-specific continuation ids and is not the provider-neutral
baseline. The stable prefix remains friendly to provider prompt caching.

**Trade-off:** durable history still gives up exact reproducibility — after the runtime
capture disappears, the reconstructed view cannot prove what the model saw before a
correction landed. That is accepted: no renderer version or rendered prompt prose is stored. Healing old
threads is worth more than a permanent prompt audit log, and a version integer only
tells you *which* renderer ran, never what it produced.

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

Attempt state is deliberately not copied into Coach context. The durable relationship
is **one nullable back-pointer at conclusion**, which buys the reverse
  lookup *from outside the trainer* ("open the Coach chat from when I got this
  wrong", from the history/review screen):
  `concluded_submission_id bigint references public.submissions(id) on delete set null`.
  Shipped in phase 3: `recordSubmission` (`src/lib/progress.ts`) returns the inserted
  id via `.select("id").single()`, and `coach.recordWorkConclusion` writes the
  back-pointer best-effort without blocking grading.

  Two things phase 3 must settle here, both consequences of §5's 2026-08-06 revision
  (a concluded thread is still offered back, so a thread can now outlive the
  submission that concluded it):

  - **Which submission wins.** One anchor can conclude more than once — a problem
    skipped and later answered in the same session writes two `submissions` rows, and
    the same thread is offered back across both. A single column must pick: **last
    write wins** is the better default, since the reverse lookup wants the sitting the
    student is reviewing now, and the earlier turns are still in the transcript.
  - **It is no longer the *only* route back.** The trainer now offers a concluded
    thread at its anchor, so this column serves the review screen specifically. That
    makes it lower-priority than it reads above, not redundant.

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
    skipped: boolean;
    leftAnchor: boolean;
    idleMs: number;   // now - last_active_at
}

/** How long a thread stays offerable, concluded or not. Tuning knob, not a rule. */
export const WORK_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** Concluded? Submitting or skipping does it. Decides retirement, and the prompt's wording. */
export function workConcluded(s: WorkAnchorState): boolean {
    return s.submitted || s.skipped;
}

/** May the thread be offered back if the user returns to the anchor? Drives the prompt. */
export function workResumable(s: WorkAnchorState): boolean {
    return s.idleMs < WORK_STALE_AFTER_MS;
}

/** When the row releases its anchor slot. Retired ≠ deleted: it stays in history. */
export function workRetirable(s: WorkAnchorState): boolean {
    return workConcluded(s) && s.leftAnchor;
}
```

**`skipped` concludes the work; `revealed` is not a lifecycle field at all
(resolved 2026-08-05).** A skip writes a real `submissions` row and is an explicit
"I'm done with this" — left out of `workConcluded`, its thread would stay live and
hold the anchor's index slot until staleness or a return visit cleared it.
`revealed` was dropped from the interface rather than wired in: showing the answer
is a *solution-access* gate (§6's `get_solution`), not the end of a sitting, and a
student who reveals and then asks "why?" is exactly who the thread is for. A spec
field no function reads is a promise the code isn't keeping.

**Conclusion does not suppress the offer (revised 2026-08-06).** `workResumable`
originally read `!workConcluded(s) && …`, so returning to a problem you had
submitted or skipped opened blank. That was backwards: the chat about a problem
you just got wrong is the one you most want back, and "what was I struggling with
here?" is the reason the thread was worth keeping at all. A concluded thread is
offered exactly like an unconcluded one — `workConcluded` now decides only how the
prompt is *worded* ("you talked this problem through" / "Open that chat" versus
"Continue"), which is a real caller, not a spec field no function reads.

**Staleness is therefore the only rule left in `workResumable`,** and it is the one
that matters: the root session never ends, so without a cutoff the trainer would
offer a week-old thread the student has entirely forgotten. Staleness only
suppresses the *prompt*; the row is still in history, and taking the fresh thread
retires it through the same `retired_at = now()` path as an explicit "new chat"
(§2), releasing the index slot.

**The lookup therefore includes retired threads** (`workConversationForAnchor`
orders by `last_active_at` and takes the newest, filtering only `archived_at`).
It has to: finishing a sitting is exactly what retires the row, so a lookup
restricted to live rows could never find the sitting most worth reviewing. Only
*live* rows are bounded to one per anchor, hence the ordering. Attaching to a
retired thread is safe — writes go by conversation id, and a retired row is not
competing for the anchor slot, so nothing can collide.

**Concluded ≠ retired, on purpose.** Submitting a wrong answer is the moment a
student most wants to ask "why?" — so the thread stays live and writable while
they remain on the problem, and is retired only when they move on. Returning to
the problem later is then *offered* that discussion back rather than starting
clean — retiring released the anchor slot, it did not hide the thread.

### Where phase 2 lives

The pure rules are `$lib/ai/session/{anchor,lifecycle}.ts`; everything else is
plumbing around them.

| Seam | Code |
| --- | --- |
| Anchor a sitting, decide the prompt | `coach.openWorkThread(anchor, state)` — promotes, looks up, offers or retires |
| Answer the prompt | `coach.resumeWorkThread()` / `coach.startNewWorkThread()`; UI in `coach-resume-prompt.svelte` |
| Leave the anchor | `coach.releaseWorkAnchor(state)` — the only caller of `workRetirable` |
| Trainer wiring | `PracticeView.svelte` `setCoachMode` + the release `$effect`; `recordSkip` sets `skipped`. The anchor it holds is `coach-anchor.ts` (pure), **not** the Coach's visibility — see below |
| The lookup | `GET /api/ai/work-thread` → `workConversationForAnchor` — newest thread at the anchor, **retired or not** |
| Create with a kind/anchor | `ensureConversation({ thread })`, which also raises `AIWorkAnchorConflict` |
| Bump `last_active_at` | `touchConversation`, and nothing else |

Four things a reader will otherwise look for and not find:

- **The prompt has three ways to be silently suppressed, and all three were bugs.**
  The lookup needs the bootstrap (the saving preference lives there, and a null one
  reads as "saving is off", so the first open after a page load never asked); it needs
  the chat to be empty, so `openWorkThread` leaves behind any thread that is not this
  sitting's rather than letting a stale transcript stand the lookup down; and it needs
  the anchor to have been released when the student left the last one. A suppressed
  prompt is invisible — the trainer just opens blank — so each of these reads as
  "resume doesn't work sometimes" rather than as a failure.

- **What the trainer holds is an anchor record, not a visibility flag.** Hiding the
  Coach is not leaving the anchor (the student is still on the problem, so reopening
  rejoins the thread), but changing problem is. `PracticeView` therefore keeps
  `coachAnchor` — `{problemId, submitted, skipped}`, the pure `coach-anchor.ts` —
  separate from `coachModeProblemId`, which only says whether the Coach is on screen.
  Collapsed into one variable, a Coach toggled off before moving on never released:
  the row stayed live holding its index slot, no resume prompt was ever offered again
  (`openWorkThread` sees the stale transcript and stands down), and the next problem's
  turns were filed into the previous problem's thread.
- **Staleness is decided in the browser, not in the lookup.** Not because
  `workResumable` needs trainer state — since 2026-08-06 it reads only `idleMs` — but
  because the *offer* does: `workConcluded` picks the prompt's wording from attempt
  state the server never sees, so the endpoint returns the row with `last_active_at`
  and both pure rules run together in one place.
- **`nulls not distinct` is hand-written in the migration.** pgdelta does not emit
  it, so a regenerated migration will silently drop it — and the index then stops
  bounding the sessionless case it exists for.

---

## 6. Tools

```
$lib/ai/tools/
  registry.ts   name → { schema, consequence, policy gate, run }
  problem.ts    get_solution
  attempt.ts    get_current_attempt (browser-side ephemeral state)
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

`get_current_attempt` is browser-side because an answer still being typed, its tries,
and elapsed time do not exist in the database. That also keeps BYOK direct: the tool
reads trainer state in the same browser that calls the provider. Until tools ship,
attempt state is unavailable to the model rather than copied into prompt context.

### `get_solution` — why the worked solution is a tool, not context

Injecting the full solution makes the Coach far better at diagnosing a specific
wrong turn, and far likelier to hand over the whole thing when the student
wanted a nudge. As a tool it enters the thread only when the conversation has
earned it. Four consequences:

- **Tools are policy-gated, not global.** `toolsFor(policy)` decides what the
  model is even offered. Under `test-locked`, `get_solution` is not in the list
  — the same enforcement seam that keeps answer-bearing capabilities unavailable.
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
| Context injected into the current system prompt only; never durable | `prompt.ts` `buildSystemMessage`, and `ai_messages` has no context column | **✅ Phase 3.1** — V2 snapshots compile into deduplicated scope epochs and turn-local attachments |
| Trainer sends statement + choices; no answer, no attempt state | `PracticeView.svelte` `coachProblemText` | **✅ Phase 3.1** — minimal `ProblemFact`; attempt state is tool-only |
| `CoachContextLayer.mode` consumed by nothing | only validated, `schemas.ts` `parseContextLayer` | **✅ Phase 3** — the highest-priority layer's policy gates rendering |
| `ai_conversations.mode` hardcoded `'general'`; `context_summary` snapshots context per *conversation* | `persistence.ts` `ensureConversation` | **✅ Phase 3** — both columns dropped; context is per turn |
| `task` hardcoded `"general"` on both send paths | `coach.svelte.ts`, server and BYOK sends | §6 |
| A reopened thread is relabelled `assist` whatever it was | `coach.svelte.ts` `selectConversation` | **✅ Phase 2** — `kind` comes back with the row, and a work thread re-adopts its anchor |
| Nothing anchors a thread to a problem; the trainer's Coach is one global thread | `PracticeView.svelte` `setCoachMode` | **✅ Phase 2** — `openWorkThread` anchors the sitting, and returning to it offers "continue or start new chat?" |
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
| **2** ✅ | Anchors + lifecycle (§2, §4, §5): the five columns, the unique index, the staleness cutoff, the "continue or new?" prompt | **yes** — `+kind`, `+problem_id`, `+practice_session_id`, `+last_active_at`, `+retired_at`, `+ai_conversations_work_anchor_idx` |
| **3** ✅ | Typed facts, policy, snapshots (§3); the `concluded_submission_id` back-pointer (§4); drop the superseded `mode` / `context_summary` (§2) | **yes** — `+context_snapshot`, `+concluded_submission_id`, `−mode`, `−context_summary` |
| **3.1** ✅ | Minimal problem scope; V2 scope/attachment snapshots; reference-keyed scope compilation, priority budgeting, and truncation rebasing; remove ambient profile/route/attempt telemetry | no — the existing jsonb payload is versioned in place |
| **4** | Read-only tools (§6); `task` derived rather than constant | no |
| **5** | Split `CoachStore` into session / transport / recorder / history / presence | no |

Phase 5 is last on purpose: the split is mechanical once the seams above are
real, and doing it first would mean moving code twice.
