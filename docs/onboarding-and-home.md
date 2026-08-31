# Onboarding and Home — product design

> **Status:** proposed — not implemented.
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

### 2.7 Onboarding is optional and recoverable

The welcome can be skipped. Skipping never limits product access. The short
introduction remains available from Help and can be replayed at any time.

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

Welcome mode is the first version of Home. It replaces the dashboard in the
normal page flow; it is not a modal displayed over dashboard content.

The page contains:

1. A personal welcome.
2. One recommended action: start a short practice.
3. Two quieter alternatives: browse a competition and take the quick tour.
4. A compact explanation of the core loop.
5. A visible but low-emphasis Skip action.

Proposed content shape:

```text
Welcome to ProblemCloud, Alex

Let's start with one useful problem. As you practice, ProblemCloud will learn
what you have worked on and bring problems back when they need review.

[Start a short practice]

Browse a competition                 Take the 60-second tour

Practice problems -> See what needs work -> Review at the right time
```

The exact copy may change, but these constraints do not:

- The first screen does not mention Goals, Focused series, rating, Series
  matrix, Coach configuration, or offline downloads.
- The primary action creates and opens a short default session directly.
- Browse a competition opens Library in its normal entry state.
- The tour teaches relationships between features, not a list of controls.
- Navigation remains available; the welcome is guidance, not a gate.

### 3.2 Early-use mode

Early-use mode begins when the student completes or dismisses Welcome but does
not yet have enough activity for a meaningful dashboard.

It uses the permanent post-Welcome Home structure:

1. A primary card containing the student's current work, goal or goal
   invitation, and one next action.
2. An optional, dismissible **Getting started** card.
3. A compact Progress region only when at least one value is meaningful.
4. A contextual explanation only when a newly relevant feature appears.

The primary card has stable semantic slots even when some are sparse:

- **What:** continue an active session or begin a short practice.
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

Getting started - 1 of 2
[x] Complete your first problem
[ ] Explore a competition
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

The checklist is a set of learning milestones, not required account setup. It
must not require creating a goal, selecting focused series, enabling Coach, or
visiting every page. It may be dismissed independently of the Welcome tour.

Candidate milestones are:

- complete a first graded problem;
- explore a competition or test in Library; and
- optionally open a short explanation of how goals guide Home, without requiring
  goal creation for completion.

Milestones should be inferred from authoritative product records where
possible, rather than copied into onboarding state.

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

The action is selected within the lead goal's scope. An initial priority is:

```text
active goal-scoped session
    -> otherwise goal-scoped review due
    -> otherwise unfinished work required by the goal
    -> otherwise goal-scoped recommended practice
```

The lead goal itself is promoted by what can move today, consistent with
`promote.ts`: an unfed streak outranks a near deadline, which outranks a fresh
achievement, which outranks ordinary progress. It is not selected merely by
percentage complete.

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
The first useful Progress appearance may include only values the student can
interpret from recent activity, such as problems seen and review due. Rating and
uncertainty can appear later when the rating is sufficiently grounded and the
copy explains a real state rather than filling a metric slot.

History owns chronological activity. A small Home activity item is justified
only when it supplies a continuation, correction, or review action not already
represented by Next up.

## 5. Quick tour and permanent Help

The quick tour and Help use the same content model at different depths.

### 5.1 Quick tour

The quick tour has at most four short steps:

1. The practice-review loop.
2. Practice and Library: receive problems versus choose them deliberately.
3. Progress: Overview, Review, Series matrix, and History live together.
4. A destination-specific action: start practice or browse Library.

It should use stable illustrations or simplified navigation previews, not a
fragile sequence of spotlights attached to live controls. A student can exit at
any step without losing access or being returned to the beginning later.

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

Help is a permanent app destination available from both the desktop account or
sidebar area and the mobile More menu. It includes:

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

Help includes **Replay introduction**. The replay does not reset milestones or
change the student's Home mode.

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

Both `completed` and `dismissed` leave Welcome mode. Completed means the short
introduction was finished; it does not mean every feature was configured or
visited.

The version allows a future release to add a small, deliberate introduction
without replaying obsolete steps. A version change must not automatically reset
all acknowledgement; the migration decides which new material is important
enough to show.

### 6.2 Derived milestones

Where available, derive milestones from authoritative data:

- active or completed practice session;
- first graded submission;
- review items due;
- goal existence and status;
- rating history; and
- meaningful Library or feature usage only if the product truly needs that
  distinction.

A submission is the authority for "completed a problem." Onboarding must not
maintain a second boolean that can disagree with it.

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

### Phase 1 — remove redundancy

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

### Phase 2 — Welcome and private state

- Add Welcome mode.
- Add the direct short-practice action.
- Persist versioned Welcome state in a private table.
- Add the short tour and permanent Help entry point.

### Phase 3 — progressive guidance

- Add Getting started for early-use accounts.
- Add first-review and first-matrix contextual guidance.
- Refine Established Home thresholds and Next up priority using observed use.

Each phase must work independently. Failure to load onboarding state must fall
back to a usable Home and must never block Practice, navigation, or account
access.

## 11. Decisions still open

The following need product or implementation validation before building:

1. The exact size and settings of the default short practice session.
2. The activity threshold for showing the compact Progress snapshot.
3. Whether Getting started contains two or three milestones after usability
   testing.
4. Whether Help is a dedicated route, a responsive panel, or a route with
   contextual deep links. It must remain directly addressable either way.
5. Whether following a series remains a named preference or becomes an implicit
   input derived from Library and practice behavior.
6. How a lead goal is selected when several goals exist: explicit student
   choice, a stable product default, or a combination that never causes the
   hero to change unexpectedly.

These questions do not change the central decision: first-run Home is a calm
welcome; once a goal exists, established Home is organized around reaching it;
and every additional section must still change the student's next action.
