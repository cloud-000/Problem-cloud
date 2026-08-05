# AI Coach — Sessions, Context & Tools

> **Status: Phase 0 shipped; §1–§6 are the target state, not yet built.** This is
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

| | **Work** | **Assist** | **One-shot** |
| --- | --- | --- | --- |
| Example | Coaching on AMC 10A #18 in the trainer | "what should I review?", "find that cyclic-quadrilateral problem" | Library query bar; a quick-ask that was never escalated |
| Anchored to | one problem in one practice session | nothing | nothing |
| Persisted | yes | yes | **never — no DB row exists** |
| Auto-resumed | **yes, by prompt** (§4) | no — new thread each open, history one click away | n/a |
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
panel or the trainer flushes that transcript to the server in a single request,
creating the conversation with the turns it already has.

This works only because **the client mints the conversation UUID up front**.
Promotion is a flush, not an id negotiation. There is no assist → work promotion
(decided 2026-08-05): starting practice from an assist thread opens a *new* work
thread for the problem and leaves the assist thread alone.

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
  -- Typed FK rather than a text id so a deleted problem takes its threads with it.
  add column problem_id bigint references public.problems(id) on delete cascade,

  -- Which sitting. This is what makes "resume the same attempt" mean something:
  -- the same problem in a NEW practice session is a NEW thread, not the old one.
  add column practice_session_id bigint
    references public.practice_sessions(id) on delete cascade,

  -- Retention + staleness, without overloading updated_at.
  add column last_active_at timestamptz not null default now();

alter table public.ai_messages
  -- The facts that were live when this turn was sent (§3).
  add column context_snapshot jsonb not null default '[]'::jsonb;
```

The one line that implements "you have an existing session — continue or new?":

```sql
create unique index ai_conversations_work_anchor_idx
  on public.ai_conversations (user_id, problem_id, practice_session_id)
  where kind = 'work' and archived_at is null;
```

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
later prove what the model saw before a correction landed. That is the right
trade here, but a `renderer_version` integer is recorded alongside the snapshot
so a strange-reading thread can be traced to the renderer that produced it.

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

`practiceSessionId` is null when the problem is opened outside a practice session.
Null participates in the unique index via the index expression, so "this problem,
no session" is its own single slot.

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
}

/** Has the work this thread was opened for concluded? v1: submitting concludes it. */
export function workConcluded(s: WorkAnchorState): boolean {
    return s.submitted;
}

/** May the thread be resumed if the user returns to the anchor? Drives the prompt. */
export function workResumable(s: WorkAnchorState): boolean {
    return !workConcluded(s);
}

/** When the row is actually archived — freeing the unique index slot. */
export function workArchivable(s: WorkAnchorState): boolean {
    return workConcluded(s) && s.leftAnchor;
}
```

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

For reviewers comparing against the code as of 2026-08-05:

| Current behavior | Where | Replaced by |
| --- | --- | --- |
| Context injected into the current system prompt only; never durable | `prompt.ts:24`, `ai_messages` has no context column | §3 snapshots |
| Trainer sends statement + choices; no answer, no attempt state | `PracticeView.svelte:952` | §3 `AttemptFact` |
| `CoachContextLayer.mode` consumed by nothing | only validated, `schemas.ts:152` | §3 policy |
| `task` hardcoded `"general"` on both send paths | `coach.svelte.ts:342,410` | §6 |
| Bootstrap always resumes the newest thread, entire transcript unbounded | `persistence.ts:135` | §1 (assist opens fresh); **transcript bounded ✅ Phase 0** (`BOOTSTRAP_MESSAGE_LIMIT`) |
| BYOK learns its `conversationId` only after a best-effort write; a failed write silently splits the thread | `coach.svelte.ts:472-503` | **✅ Phase 0** — `#ensureConversationId()` mints it before the first token |
| `newConversation()` mid-stream re-creates a thread from the aborted turn | `coach.svelte.ts:472-503` | **✅ Phase 0** — `{conversationId, generation}` captured at send start, persistence generation-guarded |
| Memory message ids ≠ DB ids; no idempotency on save | `messages/+server.ts:60` | **✅ Phase 0** — client-supplied ids + `on conflict do nothing` |
| `default_model` written at signup, never again | `preferences/+server.ts` PATCH | **✅ Phase 0** — PATCH is a patch; the `selectedModel` setter persists |
| `retention_days` stored, enforced by nothing | — | retention job |

---

## 8. Phases

Each phase is independently shippable and leaves the app working.

| # | Scope | Schema? |
| --- | --- | --- |
| **0** ✅ | Correctness only: capture `{conversationId, generation}` at send start; client-minted conversation + message ids; idempotent saves; persist `defaultModel`; bound the bootstrap transcript | no |
| **1** | Tiers (§1): `persist` tier on the session, quick-ask holds in memory, flush-on-escalate, assist threads stop auto-resuming | no |
| **2** | Anchors + lifecycle (§2, §4, §5): the four columns, the unique index, the "continue or new?" prompt | **yes** |
| **3** | Typed facts, policy, snapshots (§3) | **yes** (`context_snapshot`) |
| **4** | Read-only tools (§6); `task` derived rather than constant | no |
| **5** | Split `CoachStore` into session / transport / recorder / history / presence | no |

Phase 5 is last on purpose: the split is mechanical once the seams above are
real, and doing it first would mean moving code twice.
