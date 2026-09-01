# Onboarding and Home — product design

> **Status:** Phases 1–3 implemented. Getting started ranking lives in
> `src/lib/onboarding/getting-started.ts`; contextual tip ids in
> `src/lib/onboarding/tips.ts`.
>
> This document defines the first-run welcome experience, the way Home changes
> as a student begins using ProblemCloud, and the permanent Help entry point.
> It is a product and information-architecture specification; component and
> schema details remain implementation decisions unless this document makes a
> product rule explicit.

## 1. Problem

The current Home page treats a new account like an established account with no
data. Immediately after signup, a student is asked to interpret sessions, goals,
focused series, recommendations, rating, review state, and recent activity.
Empty values and explanatory text occupy the same visual weight as useful
actions.

This creates three related problems:

1. The student has to learn ProblemCloud's feature vocabulary before solving a
   problem.
2. Several sections answer the same question. The header, session card, and
   Recommended next can all point to Practice; review state also appears in
   Recommended next and Progress.
3. Empty dashboard sections create more interface when less information exists.
   Goals and focused series ask for configuration before the student has enough
   context to decide whether either is useful.

Before a student has chosen a goal, the product's basic loop is simpler than
the current Home page suggests:

```text
choose or receive problems -> practice -> see what needs attention -> review
```

Once a goal exists, that loop has a destination:

```text
goal -> best next practice -> progress and review -> next step toward the goal
```

The welcome experience teaches the practice-review loop without demanding
setup. Home then reveals additional capabilities only when they can help the
student make a real decision, and organizes itself around the student's goal
as soon as one exists.

## 2. Product principles

### 2.1 Lead with practice, not setup

A new student should reach a useful problem before being asked to configure
goals, focused series, review preferences, Coach, or a personalized dashboard.
The primary first-run action starts a short session with sensible defaults; it
must not lead to another configuration-heavy screen.

### 2.2 A set goal is Home's north star

A new student is not required to create a goal before solving. Once the student
does create one, however, Home always shows a lead goal and frames its primary
action as the next useful step toward that goal. The goal is not a peer widget
competing with sessions, recommendations, and progress; it supplies the reason
those things matter.

Home keeps three roles distinct:

- the **goal** answers *why am I doing this?* and names the destination;
- the **session** answers *what am I doing now?*; and
- the primary **action** answers *what moves me forward next?*

Those roles occupy the same places in early-use and established Home. A student
should not have to relearn the page when more data becomes available.

The full goal list and management controls remain on Goals. Home shows one lead
goal, its meaningful status, and the action most likely to advance it. Other
goals appear only as compact secondary signals when they need attention.

### 2.3 One dominant next action

Home answers **"What should I do now?"** with one primary action. It must not
show several equally prominent routes to Practice or repeat the same review
state in multiple sections. When a goal exists, the answer is computed within
that goal's scope rather than independently of it.

### 2.4 Absence of data removes UI

No history means no rating card, zero-review card, empty activity feed, empty
focused-series editor, or standalone goal-setup section. After Welcome, the
primary card may contain one quiet goal invitation in its stable commitment
slot; it does not grow into another card. Empty data should make Home calmer,
not cause it to explain every section that might eventually appear.

### 2.5 Reveal concepts when they become meaningful

Review is easiest to explain after a student has submitted problems. A rating is
easiest to explain after it exists. The Series matrix is easiest to explain when
it contains recognizable work. Onboarding is therefore progressive rather than
a tour of every navigation item.

### 2.6 Help a decision or remove the words

Supporting copy belongs only when it:

- explains a consequence;
- resolves genuine ambiguity; or
- helps the student choose an action.

Text that merely restates a heading, describes the layout, or announces that a
summary is a summary is removed.

### 2.7 Onboarding is tour-first, optional, and recoverable

On a first login, Home opens the short tour before the student sees the
dashboard. The tour can always be skipped. Skipping never limits product
access; it simply opens the minimal post-Welcome Home. The introduction
remains available from Help and can be replayed at any time.

## 3. Home has three presentation modes

These modes are presentation decisions, not permanent user identities. Explicit
onboarding state selects the first transition; existing product data determines
when later information is useful.

Welcome is the one intentionally different presentation. After Welcome, early-
use and established Home use the same information hierarchy and primary-card
shape. Established Home is the early-use layout with stronger evidence and more
useful secondary signals, not a dashboard that replaces it at a graduation
threshold. Familiarity comes from stable placement and meaning; low-value empty
sections are still omitted.

### 3.1 Welcome mode

Welcome mode is the first screen after a student's first successful login. It
replaces the dashboard in the normal page flow; it is not a modal displayed
over dashboard content. Unseen accounts with no product history open the
short tour immediately. There is no interstitial "take the tour" screen: Skip
on every tour step is the way out.

The exact copy may change, but these constraints do not:

- The first screen is a personal greeting. It does not mention Goals, rating,
  the Series matrix, Coach configuration, or offline downloads.
- The tour uses interactive product mocks (Library tabs, Goals, rating plus
  Series matrix, trainer chrome) rather than a list of live controls.
- Completing the last step opens early-use Home. Skip at any step does the
  same and leaves all product access available. Welcome is deliberate
  first-run guidance, not account setup.

### 3.2 Early-use mode

Early-use mode begins when the student completes or dismisses Welcome but does
not yet have enough activity for a meaningful dashboard.

It uses the permanent post-Welcome Home structure:

1. A primary card containing the student's current work, goal or goal
   invitation, and one next action.
2. An optional, dismissible **Getting started** card after Welcome, until
   its five items are done or the student dismisses it.
3. A compact Progress region after the first graded submission, containing only
   values that exist.
4. A contextual explanation only when a newly relevant feature appears.

The primary card has stable semantic slots even when some are sparse:

- **What:** continue an active session or begin normal practice.
- **Why:** show the lead goal when one exists. Without a goal, use at most one
  quiet invitation to choose a direction; do not restore a separate setup card.
- **Next:** one button owned by the goal when one exists, otherwise by the
  current work.

Example without a goal:

```text
Welcome back, Alex

Continue "Mixed practice"
3 problems attempted - 2 correct

No goal yet - Set a direction when you are ready
[Continue]

Getting started - 1 of 5
[x] Solve 5 problems
[ ] Try practice settings
[ ] Use the whiteboard
[ ] Ask Coach
[ ] Set a goal
```

Example with a goal uses the same card rather than adding a Goals section:

```text
Welcome back, Alex

Continue "AMC 10 Geometry"
3 problems attempted - 2 correct

Solve 20 AMC 10 Geometry problems
3 of 20 complete
[Continue toward goal]
```

The checklist is a set of learning milestones, not required account setup.
Practice, navigation, and account access stay available with every item
unchecked. It may be dismissed independently of the Welcome tour. Completing
an item is inferred from product records or a one-time acknowledgement of
the gesture; onboarding must not store a second boolean that can disagree
with goals, submissions, or Coach history.

#### Getting started items

Five items, completable in any order. Home displays them in this sequence so
the card leads with practice (§2.1) and treats a goal as a destination, not a
gate:

1. **Solve 5 problems.** Five distinct problems with at least one graded
   attempt (`problem_state_summary.attempted >= 5`). Skips and extra tries on
   one problem do not count. Authority is the existing Progress summary Home
   already loads.
2. **Try practice settings.** Open Settings from inside a practice sitting
   (the trainer utility panel, not the account Settings page). Opening is
   enough; the student does not have to change a value. This gesture is not
   otherwise recorded, so the first open writes one acknowledgement.
3. **Use the whiteboard.** Draw on the trainer scratch board (or the
   standalone whiteboard page). Opening an empty board is not enough: the
   panel persists an empty document after a short debounce. Content
   (`items.length > 0`) or a one-time acknowledgement of the first stroke
   is the signal.
4. **Ask Coach.** Send at least one message from the trainer Coach, the
   Coach panel, or `/coach`. A persisted `ai_conversations` row is the
   product record. A quick-ask one-shot never writes a row, so the first
   send of any kind also writes an acknowledgement; either proof completes
   the item. History-disabled accounts still complete via the
   acknowledgement.
5. **Set a goal.** Any `goals` row for the student, including archived.
   Creating it is the lesson; Home's lead-goal slot is the lasting effect.

Each row is a link to the place the student does that thing: Practice for
problems, settings, whiteboard, and Coach; `/goals?new=1` for a goal. The
card disappears when every item is done, or when the student dismisses it
(`getting_started_dismissed_at`). Dismissal does not reset Welcome or tips.

Do not add Library, focused series, Review, or the Series matrix to this
card. Those belong in contextual tips (§5.2) at the moment they become
useful.

##### How to implement (Phase 3)

No new table. `user_onboarding` already stores dismissal and
`acknowledged_tips`. Put ranking in a pure module such as
`src/lib/onboarding/getting-started.ts` so Home and tests share one
definition of done.

| Item | Done when | Home already has it? | Write path if missing |
| --- | --- | --- | --- |
| Solve 5 problems | `summary.attempted >= 5` from `fetchProblemStateSummary` | Yes | None |
| Set a goal | `fetchGoals({ includeArchived: true })` is non-empty | Partial: Home fetches active goals only; include archived for this check | None |
| Ask Coach | `acknowledged_tips` contains `getting-started:coach`, or `ai_conversations` has a row (`select id limit 1`; SELECT is already granted) | No conversations fetch today | On first `coach.send()`, append the tip id via `saveOnboarding` |
| Try practice settings | `acknowledged_tips` contains `getting-started:practice-settings` | Yes (onboarding row) | When the trainer opens `practice-settings` in the utility panel |
| Use the whiteboard | `acknowledged_tips` contains `getting-started:whiteboard`, or `restoreDocument("whiteboard:scratch")` / `"whiteboard:page"` has `items.length > 0` | No | On first non-empty persist of those keys, append the tip id so other devices can see it |

Show the card when Welcome is over, the card is not dismissed, and at least
one item is incomplete. A failed onboarding or Coach lookup must omit or
soft-fail the card, never block Practice.

Keep first-review and first-matrix guidance as separate contextual tips
(§5.2), not extra checklist rows.

### 3.3 Established mode

Established mode preserves the early-use structure and enriches it. The top of
Home remains the same primary card with the same three roles: current work,
commitment, and next action. More history makes its recommendation more precise;
it does not cause the page to rearrange.

With a goal, the primary card contains:

1. the active or proposed piece of work;
2. one lead goal with meaningful progress, deadline, or today state; and
3. one primary next action toward it.

For example:

```text
Continue "AMC 10 Geometry"
6 problems remaining - Active yesterday

Solve 80% of AMC 10 Geometry
42 of 60 complete - 12 days left
[Practice what's left]
```

The action is selected within the lead goal's scope. For this rollout, taking a
goal action always creates a fresh named practice session from the goal's
current scope and target-aware practice settings. Home does not try to identify
or resume a prior goal session: sessions do not yet record goal provenance, and
the new session makes the action's scope truthful without that relationship.
An initial priority is:

```text
goal-scoped review due
    -> otherwise unfinished work required by the goal
    -> otherwise goal-scoped recommended practice
```

The lead goal is the student's stable primary goal: an explicit selection when
one exists, otherwise the oldest active goal as a deterministic fallback.
Urgency is computed separately, consistent with `promote.ts`: an unfed streak
outranks a near deadline, which outranks a fresh achievement, which outranks
ordinary progress. An urgent secondary commitment can appear under **Needs
attention**, but it does not replace the lead goal.

Below the primary card, established Home may fill the same secondary regions
that were sparse or absent during early use:

1. a compact secondary-goal signal, only when another commitment can move today;
2. a compact **Progress** snapshot, only when it adds context not already
   present in the primary card; and
3. a recent item only when it changes the next decision.

Without a goal, Home falls back to one general **Next up** action: continue an
active session, complete due review, or start useful practice. After the student
has enough experience to understand what they want, Home may make a quiet,
contextual invitation to turn that direction into a goal; it must not restore
the first-run `Set a finish line` setup card.

There is no visible switch from early-use to established mode. The same card and
section order remain in place while derived product data determines which facts
are useful enough to render.

The ordering and lead-goal selection should live in pure decision functions so
Home cannot show a hero and a secondary recommendation that disagree. Product
work may refine the priority, but every rendered primary action must come from
the same result.

Home is not a replacement for History, Goals, Library, or Progress. It summarizes
only what changes the student's next decision and links to the owning surface
for detail.

## 4. Current Home content disposition

| Current content | Proposed treatment |
| --- | --- |
| `Welcome back` description | Remove; Next up communicates the useful state |
| Header `Start practice` button | Remove when Next up already owns the action |
| Continue/session card | Retain as the Next up hero when it wins priority |
| `Set a finish line` empty state | Remove; after Welcome, use at most one quiet goal invitation inside the primary card. Goals owns explanation and creation |
| `Your goals` section | When goals exist, replace it with one persistent lead-goal hero that owns the primary action |
| `Focused series` section | Remove as permanent Home configuration |
| `Recommended next` | Remove; fold its decision into Next up |
| `Your progress` | Hide until meaningful data exists, then render compactly |
| `Recent activity` | History owns the feed; Home shows an item only if it changes the next action |

### 4.1 Focused series

Focused series can remain a preference without being a Home section. Its useful
effects can be expressed where they naturally apply:

- select or follow a series from Library;
- use followed series as an available lens in Progress;
- use the preference as one input to practice recommendations; and
- surface a concrete Home signal only when it is actionable, for example,
  **"AMC 10 has 4 problems ready for review."**

The interface should not require a student to learn the term "focused series"
or select up to three items merely to make Home look complete. If the preference
does not change a decision, it should not render on Home.

### 4.2 Goals

Goals owns its own empty state, explanation, and creation flow. Home does not ask
a brand-new student to "set a finish line" before they understand the product.
After Welcome, the primary card may offer a single quiet goal invitation in the
same slot where a lead goal will later appear. Once a goal exists, Home always
surfaces one lead goal there. It is the organizing context for the winning
practice action, not an optional row shown only when a deadline becomes urgent.

The lead-goal hero answers three questions together:

- What am I working toward?
- Where do I stand?
- What should I do next to advance it?

For example:

```text
Your goal

Reach 80% confidence in AMC 10 Geometry
64% complete - 18 days left

Next: Review 4 problems
[Continue toward goal]
```

If several goals exist, Home still has one lead goal so its hierarchy remains
stable. Other goals do not become a second dashboard; only a concise urgent
signal appears when one needs attention. Goal detail, selection, creation, and
the complete list remain on Goals.

This stable placement is a product rule: the early-use goal invitation, the
first goal at zero progress, and an established goal with history all inhabit
the same primary-card region. Only the quality and density of the information
change.

### 4.3 Progress and activity

Progress values should not appear as zeros or placeholders for a new student.
The first compact Progress appearance is after the first graded submission and
includes only values the student can interpret from recent activity, such as
problems seen and review due. Rating and uncertainty appear only after the
rating is no longer provisional; neither is a slot that must be filled.

History owns chronological activity. A small Home activity item is justified
only when it supplies a continuation, correction, or review action not already
represented by Next up.

## 5. Quick tour and permanent Help

The quick tour and Help use the same content model at different depths.

### 5.1 Quick tour

The quick tour has five short steps:

1. A personal greeting (`Hi, {username}.`).
2. Library: Problems, Tests, and Series, with a clickable mock of the three tabs
   that shows live catalog rows through the real Library list (drill series →
   tests → problems; outbound practice/Coach/AoPS actions stay off).
3. Goals: a destination Home can follow, with a clickable mock of lead-goal cards.
4. Progress: rating climb and Series matrix on one slide, both interactive mocks.
5. Practice: the core loop, with a mock of the trainer chrome (whiteboard, Coach,
   settings). Completing this step opens Home.

It should use interactive product mocks, not a fragile sequence of spotlights
attached to live controls. A student can skip at any step to reach minimal Home,
or exit an in-progress tour and resume later without losing access or being
returned to the beginning.

### 5.2 Contextual introductions

One-time guidance appears at the moment a feature becomes useful:

- after the first graded problem, explain that the attempt contributes to
  Progress;
- when review first becomes due, explain why the problem returned;
- on the first meaningful Series matrix visit, explain its cell states and
  interaction; and
- on the first goal creation, explain that practicing the goal creates a session
  scoped to the goal.

Tips are dismissible and must not repeatedly reappear across devices after they
have been acknowledged.

### 5.3 Help

Help is a permanent, directly addressable `/help` route available from both the
desktop account or sidebar area and the mobile More menu. It includes:

1. Quick start and the core loop.
2. Practice and sessions.
3. Library search, tests, and series.
4. Progress, Review, Series matrix, and History.
5. Goals.
6. Coach, Whiteboard, and offline content where enabled.

Every Help section answers:

- What is this useful for?
- Where does it live?
- What is a concrete example?
- What direct action opens it?

Help includes **Replay introduction**, which opens the tour as a dialog or
sheet. The replay does not reset milestones or change the student's Home mode.

## 6. Onboarding state

Onboarding state records UI acknowledgement. It does not duplicate product
facts already proven by sessions, submissions, goals, or progress.

### 6.1 Explicit state

The persisted model needs to represent:

- the onboarding content version;
- Welcome status: `unseen`, `in_progress`, `completed`, or `dismissed`;
- the last completed tour step, for cross-device continuation;
- whether Getting started was dismissed;
- the set of contextual tips already acknowledged; and
- relevant completion or dismissal timestamps.

The state transition is:

```text
unseen -> in_progress -> completed
   \------------------> dismissed
```

Both `completed` and `dismissed` leave Welcome mode. Completing the tour marks
`completed`; skipping it marks `dismissed`. Neither means every feature was
configured or visited.

The version allows a future release to add a small, deliberate introduction
without replaying obsolete steps. A version change must not automatically reset
all acknowledgement; the migration decides which new material is important
enough to show.

### 6.2 Derived milestones

Where available, derive milestones from authoritative data:

- five distinct graded problems (`problem_state_summary.attempted`);
- goal existence, including archived;
- a persisted Coach thread (`ai_conversations`);
- active or completed practice session;
- review items due; and
- rating history.

A submission is the authority for "completed a problem." A `goals` row is
the authority for "set a goal." A Coach conversation row is the authority
for a remembered Coach thread. Onboarding must not maintain a second
boolean that can disagree with those.

Two Getting started items have no product table today: opening practice
Settings, and using the whiteboard (device-local `localStorage` only).
Those may use a one-time id in `acknowledged_tips`. That is acknowledgement
of a gesture, not a copy of submissions or goals. Do not infer "tried
settings" from `practice_sessions.settings` — goal handoffs and custom
starts already write non-default snapshots without the student opening
Settings, and opening the panel currently writes nothing.

### 6.3 Privacy and storage boundary

`public.profiles` is world-readable. Private behavioral metadata such as tour
progress and acknowledged tips must not be added to that table.

Use a private self-readable, self-writable table such as `user_onboarding`, or a
future general private user-preferences table. Its row is keyed by `user_id`,
protected by self-only RLS, and created lazily or by the existing new-user
trigger. Exact columns versus a validated JSON document are an implementation
decision; the product states above are the contract.

Cross-device persistence is required for registered accounts. A browser-local
fallback may make the UI resilient while signed out or offline, but it is not
the account's source of truth.

## 7. Content rules

Home headings and copy should describe state or consequence, not interface
taxonomy.

Prefer:

- `4 problems are ready to revisit.`
- `Your last session has 7 problems remaining.`
- `Geometry is currently your clearest weak area.`
- `Complete a few rated problems before topic trends appear.`

Remove or rewrite copy like:

- `A compact snapshot of your recent work.`
- `Use your review schedule or choose what you want to explore.`
- `Pick up where you left off or work on what needs attention.`
- `Pick up to 3 series to track closely on this page.`

Additional rules:

- Do not call a generic action "recommended" unless the product can state why
  it is recommended.
- Do not render a description solely because the section component accepts one.
- Avoid internal terms before they are explained. Prefer "competition" or the
  actual series name over "focused series."
- Use one label consistently for the same destination. Review lives under
  **Progress -> Review** even when Home links directly to it.

## 8. Accessibility and responsive behavior

- Welcome and tour content remain usable without animation.
- The core loop is understandable as text; an illustration is supplementary.
- Tour progress is announced semantically and does not rely on color.
- Keyboard focus moves to the new step heading when advancing the tour.
- Skip, Back, and Close have explicit accessible names and predictable results.
- Mobile preserves the same action hierarchy; secondary actions must not become
  equally prominent merely because they stack vertically.
- Contextual tips never cover the control they explain and do not trap focus
  unless they are true dialogs.

## 9. Success criteria

The redesign should be evaluated against behavior, not tour completion alone.
Useful measures include:

- signup-to-first-problem-started;
- signup-to-first-graded-submission;
- abandonment before the first problem;
- return to an active session;
- first use of Review after it becomes due;
- creation of a first goal after the student has enough context to choose one;
- starts and graded submissions from the Home goal action;
- progress toward and completion of the lead goal;
- Help opens and introduction replays; and
- Welcome completion versus dismissal, without treating dismissal as failure.

Event collection must be purpose-limited. Product records should answer product
milestones when possible; onboarding analytics should not become a parallel
history of every route and click.

Qualitative checks matter as much as conversion:

- Can a new student explain the Practice -> Progress -> Review loop?
- Can they start solving without configuring anything?
- Can they find Review and Series matrix later?
- Once they set a goal, can they explain how Home's primary action advances it?
- Does Home become more useful as data accumulates rather than merely larger?

## 10. Rollout sequence

### Phase 1 — remove redundancy ✅

- Replace the header/session/Recommended next competition with one Next up
  decision for students without goals and one goal-led decision for students
  with goals.
- Give both decisions the same permanent primary-card structure: current work,
  goal or goal invitation, and one next action.
- Remove Recommended next.
- Hide empty Progress and Recent activity.
- Remove the Goals and Focused series empty/setup states from Home.
- Make an existing lead goal the persistent organizing context for Home's
  primary action.

This phase improves every account without requiring onboarding persistence.
The decision lives in `src/lib/home-next.ts` so the heading and the button
cannot disagree. After Phase 2, first-run accounts see Welcome from
`src/lib/onboarding/` instead of that card.

### Phase 2 — Welcome and private state ✅

- Add Welcome mode.
- Open the short tour immediately for unseen first-run accounts, with Skip
  available at every step.
- Persist versioned Welcome state in a private table.
- End the tour on the trainer mock, then open Home.
- Add the permanent `/help` route.

The tour replaces Home until it is completed or skipped. There is no separate
"take the tour" screen; Skip on every tour step is the way out. State lives
in `public.user_onboarding` (self-only RLS) and the decision in
`src/lib/onboarding/welcome.ts`, so a failed load falls back to Home rather
than blocking Practice. Help is `/help`, linked from the account menu, and
**Replay introduction** opens the same tour without changing Home mode once
Welcome has already finished.

### Phase 3 — progressive guidance ✅

- Add Getting started for early-use accounts (five items in §3.2).
- Add first-review and first-matrix contextual guidance.
- Refine Established Home thresholds and Next up priority using observed use.

Getting started is the remaining early-use surface: it hides when every item
is done or dismissed, and Home's primary-card ranking from Phase 1 is
unchanged. First-progress, first-review, first-matrix, and first-goal tips
share `acknowledged_tips` so they do not reappear across devices.

Each phase must work independently. Failure to load onboarding state must fall
back to a usable Home and must never block Practice, navigation, or account
access.

## 11. Decisions still open

Getting started item count, content, and tip ids are settled in §3.2
(`getting-started:practice-settings`, `getting-started:whiteboard`,
`getting-started:coach`). Home also reads the whiteboard localStorage
fallback so a same-device stroke still completes the item if the
acknowledgement write failed.

Followed series and similar preference-driven signals are optional, default
hidden enhancements. They are not a prerequisite for Home and render only when
they create an actionable decision.
The lead-goal selection is settled by Goal experience Phase 3: an explicit
student choice wins; otherwise Home uses the oldest active goal as a stable
fallback. A goal action always starts a new goal-configured session for this
rollout; session reuse and explicit goal-session provenance are deferred.

These questions do not change the central decision: first-run Home is a calm
welcome; once a goal exists, established Home is organized around reaching it;
and every additional section must still change the student's next action.
