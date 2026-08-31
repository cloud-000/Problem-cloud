# Goal experience — product design

> **Status:** proposed — not implemented.
>
> This document defines how students create, understand, and act on goals. It
> complements [`goals.md`](./goals.md), which remains authoritative for goal
> evaluation, scope, lifecycle, and achievement semantics. Where this proposal
> would require changing those product rules, the conflict must be resolved in
> `goals.md` before implementation.

## 1. Problem

The current Goals UI exposes the evaluator model before it establishes a useful
student mental model. Creating a goal begins with a title and one of eight target
types, continues through target-specific numbers and the full Practice Track,
and only at the end produces the sentence that explains what the goal means.

This creates five related problems:

1. **Implementation taxonomy becomes the first decision.** A student must
   distinguish attempted count, attempted percentage, solved count, solved
   percentage, volume, accuracy, speed, and streak before stating what they want
   to accomplish.
2. **Different kinds of commitment appear equivalent.** A destination, a daily
   routine, and a performance measure are all independent Goals competing for
   the same prominence.
3. **One generic progress treatment obscures different semantics.** Completing
   14 of 20 problems, measuring 82% accuracy over a sample, and reaching day 9
   of a streak do not progress in the same way.
4. **A goal has several competing identities.** Custom title, generated finish
   line, and scope description all appear together, leaving the student to
   decide which phrase is the real commitment.
5. **Urgency can destabilize the north star.** Ranking an unfed streak above a
   competition objective may correctly identify what expires today, but it can
   also make Home appear to change the student's destination.

The result is a powerful goal engine presented as a form builder. If Goals is
Home's north star, this confusion propagates into onboarding, recommendations,
and practice handoff.

## 2. Product rules this design preserves

This proposal does not weaken the core contracts in `goals.md`:

- A goal remains a commitment to one finish line on one defined slice of the
  catalog, optionally by a deadline.
- Every metric continues to use submissions and canonical problem identity as
  its source of truth.
- Goal scope remains structurally identical to the Practice Track, so practicing
  a goal cannot silently draw from different material.
- Existing work counts according to the target family's established rules.
- A deadline remains a horizon, not a second finish line; passing it does not
  erase progress or fail the goal.
- Achievement remains explicit stored state and is never inferred differently
  by each surface.
- No goal combines multiple metrics into a blended score. A grouping or plan
  may relate independent goals, but each child commitment still has exactly one
  evaluator and one achievement condition.

The design changes what the student is asked to understand and when. It does
not invent a second definition of goal progress.

## 3. Student mental model

The interface should distinguish three **presentation roles**, even if the
underlying records initially remain independent goals. They are not target
types, a second lifecycle, or a classification the student must learn or choose
while creating a goal. A student creates an ordinary, independently evaluated
goal by stating an intent and finish line. The product may later identify one as
their main destination and present other goals according to what they mean or
what needs attention.

In student-facing UI, prefer the commitment itself over these role names:

```text
Your main goal
Solve 20 AMC 10 Geometry problems

Needs attention
Practice 3 more problems today

Other goals
Reach 85% accuracy on fresh algebra problems
```

The roles explain hierarchy for product design; they should not appear as a
required **Primary / Supporting / Measure** chooser in the creation flow.

### 3.1 Primary goal: the destination

The primary goal answers:

> What am I principally trying to accomplish?

Examples include:

- Solve 20 AMC 10 Geometry problems.
- Work through 80% of the 2020–2025 AMC 12 catalog.
- Reach 85% accuracy on my next 30 fresh algebra problems.

A student may have several active goals, but one stable primary goal gives Home
and the Goals page a comprehensible north star. It is presented as the main
goal, not as a goal of a special type. The product must not silently replace
that identity merely because a different commitment is more urgent today.

### 3.2 Supporting commitment: the method

A supporting commitment answers:

> What routine or nearer-term promise will help me get there?

Examples include:

- Practice five problems each day for fourteen days.
- Complete 100 attempts this month.

Supporting commitments may demand attention without becoming the student's
destination. An unfed streak can be the most urgent item today while the primary
competition goal remains visually stable. When actionable, present the concrete
next requirement (for example, **Practice 3 more today**) under **Needs
attention**, rather than calling it a supporting commitment.

### 3.3 Measure: evidence of improvement

A measure answers:

> What evidence tells me whether my work is improving?

Accuracy and speed targets often play this role, though a student may choose one
as a primary goal. Present it with its actual commitment and family-appropriate
progress (for example, accuracy plus the number of fresh problems measured),
not a **Measure** badge. The UI role is therefore not permanently determined by
target type; it comes from the student's intent and relationship between
commitments.

### 3.4 Goal plans are a possible presentation model

A stronger future model could group independent goals into a plan:

```text
Prepare for AMC 10 Geometry
  Primary finish line: Solve 80% of the material
  Routine: Practice 5 problems per day
  Measure: Reach 85% accuracy on fresh problems
```

This must remain a relationship among independently evaluated commitments, not
one multi-condition goal. A first release can improve creation and allow one
goal to be primary without introducing plans into persistence.

## 4. Creation flow

Creation starts with intent and ends with a plain-language commitment. It should
not begin with an empty optional title or an eight-item evaluator select.

A dedicated page or spacious responsive sheet is preferable to one long modal.
The student should see one meaningful decision at a time and be able to move
back without losing prior answers.

### 4.1 Step 1 — choose the intent

Present a small set of student-facing choices with examples. These choose the
kind of commitment to configure; they do not ask the student to classify it as
primary, supporting, or a measure:

1. **Work through material**  
   Cover a competition, test, or topic.
2. **Solve material confidently**  
   Finish a defined number or share correctly.
3. **Improve my performance**  
   Target accuracy or speed on new work.
4. **Build a practice routine**  
   Practice a regular amount or maintain a streak.

These choices route to existing target types. Count versus percentage and
sample-window configuration appear only after the student has chosen an intent.

### 4.2 Step 2 — choose the material

Lead with common scope choices:

- a competition series;
- a particular test;
- a topic;
- everything eligible; or
- a custom selection.

The full Track remains available behind **Customize selection**. Common goals
must not require understanding division, format, and multi-series clauses.

As the student chooses, the interface shows the actual material in ordinary
language and reports the eligible denominator when relevant:

> AMC 10 Geometry · 74 gradeable problems

An empty scope must be described as all eligible material, not as an invisible
absence of filters.

### 4.3 Step 3 — set the finish line

The controls form a sentence appropriate to the selected intent.

Set completion:

```text
I want to [attempt / solve] [20 problems / 80% of this material].
```

Volume:

```text
Complete [100 attempts] [this month].
```

Accuracy:

```text
Reach [85% accuracy] over my next [30 fresh problems].
```

Speed:

```text
Average [2 minutes or less] while staying at least [70% accurate]
over [30 problems].
```

Streak:

```text
Complete at least [5 problems] per day for [14 days].
```

The UI may recommend useful defaults, but each target's existing validation
rules remain authoritative.

### 4.4 Step 4 — optional horizon

Deadline is optional and visually secondary. The copy must make its semantics
clear:

> A date to plan around. Passing it does not erase the goal or your progress.

Recurring periods and streak timezones remain part of the finish line where the
evaluator requires them; they are not presented as generic deadline behavior.

### 4.5 Step 5 — review the commitment

Before saving, show an editable commitment statement, prefilled with the
generated sentence, and its consequences:

```text
[ Solve 20 AMC 10 Geometry problems by October 1 ]

You have already solved 6 of 74 eligible problems.
14 more will complete this goal.

[Create goal]                  [Create and start practicing]
```

The generated commitment is the default, not an immutable label. A student who
likes it can save without editing; a student who wants to state their purpose in
their own words can edit it. The saved text is the goal's primary display
identity.

Editing this text changes the student's label for the commitment, not its
evaluator. Material, target, sample window, period, deadline, and every other
condition that determines what counts remain explicit structured inputs and are
shown in the review. The product must not imply that rewriting the statement
changes those conditions.

If creation would immediately achieve the goal because existing work already
qualifies, state that before saving.

## 5. Goals page

The Goals page should establish hierarchy rather than render an undifferentiated
list of records.

### 5.1 Primary goal

The stable primary goal receives the lead position:

```text
Your main goal

Solve 20 AMC 10 Geometry problems by October 1
6 of 20 solved · 14 remaining

[Practice what's left]
```

Its primary action states what practice will do. Generic **Practice** is used
only when no more specific, truthful action is available.

### 5.2 Needs attention

Urgent supporting commitments appear separately without displacing the primary
goal:

```text
Needs attention

Practice 5 problems a day
2 of 5 today · 12-day streak
[Practice 3 more]
```

This separates **stable importance** from **today's urgency**.

### 5.3 Other goals

Other active goals use compact rows. The complete list belongs here, not on
Home. Achieved and archived goals remain readable through explicit filters or
sections.

Cards should not lead with an `Active` chip. Active is the default lifecycle
state, not useful guidance. Prefer consequential status:

- 3 more today;
- 4 problems remaining;
- 8 days left;
- 12 more fresh attempts needed;
- achieved August 31; or
- past planning date.

`Overdue` should be avoided unless the UI also makes clear that the goal has not
failed. **Past planning date** or direct date language better matches the
existing deadline contract.

## 6. Progress presentation by family

Every goal card answers the same questions—where am I, what counts next, and
what should I do—but it does not force every evaluator into the same visual.

### 6.1 Set completion

Use cumulative progress:

```text
14 of 20 solved
[====================------] 70%
6 remaining
```

For percentage targets, distinguish progress toward the target from coverage of
the whole eligible scope.

### 6.2 Volume

Show count within the period and make reset behavior visible:

```text
63 of 100 attempts this month
Resets September 1
```

For finish-once periods, say that reaching the count completes the goal
permanently.

### 6.3 Accuracy

Accuracy has two dimensions: measured performance and sample completion. Show
both:

```text
82% accuracy                         Target 85%
18 of 30 fresh problems measured
```

A single fill bar must not imply that collecting more samples automatically
improves accuracy.

### 6.4 Speed

Show time and correctness together because both are achievement conditions:

```text
103-second average                  Target ≤120s
76% accuracy                        Minimum 70%
18 of 30 problems measured
```

### 6.5 Streak

Show the current day and the sequence separately:

```text
Day 9 of 14
3 of 5 problems today
```

A short day strip or calendar treatment is more truthful than one generic
percentage bar.

### 6.6 Insufficient data

Replace a bare dash with an explanation of what remains before evaluation:

> 18 of 30 fresh problems measured. Complete 12 more to evaluate this goal.

## 7. Goal detail

Goal detail should lead with meaning and action rather than restating the data
model.

Recommended order:

1. Student-facing commitment and consequential status.
2. One next action.
3. Family-appropriate progress explanation.
4. What remains, when that set is defined.
5. Planning details: material, finish line, deadline, and creation date.
6. Edit, archive, and delete controls at lower emphasis.

Headings such as **Where you are** and **The commitment** are optional. If the
content is already self-explanatory, adding taxonomy creates more reading
without adding meaning.

## 8. Home integration

Home uses the same distinction as the Goals page:

- the primary goal is the stable destination;
- the current session is the work in progress;
- a supporting commitment can demand attention today; and
- the primary action says exactly what work it will start or continue.

An urgent supporting commitment may appear in **Needs attention**, but it must
not silently replace the primary goal as Home's north star.

This creates a deliberate unresolved conflict with the current interpretation
of `promote.ts`, which selects the lead item entirely by what can move today.
Before implementation, product must decide whether promotion selects:

1. the primary goal itself;
2. only the next action or attention signal; or
3. the primary goal only when the student has not explicitly chosen one.

The recommended direction is to separate two decisions:

```text
primaryGoal = stable student destination
attentionGoal = commitment with the strongest reason to act today
```

They may be the same goal. When they differ, Home keeps the primary goal stable
and presents the attention goal as a concise secondary signal.

## 9. Empty state and onboarding

Welcome does not require goal creation. When a student intentionally opens
Goals with none set, the Goals page owns the explanation:

> A goal gives your practice a destination. Choose material you care about and
> a finish line you can recognize.

Offer concrete starting paths rather than a paragraph listing every possible
target:

- Work through a competition
- Improve a topic
- Build a practice routine

After Welcome, Home may show one quiet invitation in the stable goal slot. It
links into this intent-first flow and does not reproduce the Goals empty state.

## 10. Language rules

- Lead with the student's human commitment (prefilled from the generated
  default), not evaluator type names.
- Explain **attempt** versus **solve** at the point of choice.
- Explain **fresh problems** before using it as a sample rule.
- Prefer the actual competition or topic name over **scope** in student-facing
  copy.
- Use **scope**, **target family**, and **evaluator** only in technical or
  advanced contexts.
- Do not label a goal `Active` when a more useful consequence is available.
- Do not call a planning date a failure state.
- Name actions by their result: **Practice what's left**, **Review 4 due
  problems**, or **Complete 3 more today**.

## 11. Accessibility and responsive behavior

- Intent choices are real labeled controls, not clickable decoration.
- The sentence builder remains understandable when read linearly by assistive
  technology.
- Changing intent announces the resulting finish-line controls and preserves
  compatible answers when moving back.
- Progress never relies on color or bar length alone; the numeric state and
  target are always present.
- Mobile preserves the same decision order and does not compress several
  numeric conditions into an unreadable row.
- The review step receives focus at its heading and exposes validation errors
  before the Create action.

## 12. Delivery sequence

### Phase 1 — clarify existing records (done)

- Make the saved commitment text, prefilled from the generated default, the
  primary card identity.
- Replace generic status chips with consequential status text.
- Introduce family-appropriate progress presentations.
- Rename practice actions by what they will do.
- Reduce duplicate title, target, and scope copy.

This phase can preserve the existing persistence model and creation form.

**Exit criteria**

- For every shipped target family, a goal card and detail view lead with its
  saved commitment text, show a consequential status, and use the
  family-appropriate progress treatment in §6.
- Each available practice action truthfully states what it will do and draws
  from the goal's existing scope.
- Existing creation, editing, archiving, achievement, and practice handoff
  behavior continue to create and evaluate the same records as before.
- Representative goals from every target family are checked against their
  evaluator output so the new wording and visuals do not change what counts or
  when a goal is achieved.

**Enables Phase 2:** a stable, plain-language commitment and progress
vocabulary that the creation review can produce and verify.

### Phase 2 — intent-first creation (done)

- Replace the target-type-first modal with the guided creation flow.
- Add common material presets with the full Track behind customization.
- Prefill an editable commitment statement from the reviewed generated
  commitment; saving without editing retains that default.
- Offer **Create and start practicing** when a truthful handoff exists.

**Exit criteria**

- A student can create every shipped target family through the intent-first
  flow without seeing target-family, evaluator, primary, supporting, or measure
  terminology as a required choice.
- Every flow path maps to the existing target configuration and validation
  rules; no new input path changes the definition of what counts or completes a
  goal.
- The review step prepopulates the editable commitment statement from the
  generated default, preserves a student's edits when they go back, and shows
  the saved text after creation. It states current qualifying work and immediate
  achievement when applicable.
- Editing the commitment statement does not alter the structured evaluator
  configuration or imply a different achievement condition.
- Common material choices and **Customize selection** resolve to the same Track
  scope used by goal evaluation and practice handoff.
- **Create and start practicing** is offered only when the resulting practice
  action is valid for that goal's scope and state.

**Enables Phase 3:** goals are understandable as independent commitments, so
the product can assign presentation hierarchy without making students learn a
new kind of goal.

### Phase 3 — stable primary goal

- Add or derive a stable primary-goal selection.
- Separate primary-goal selection from urgency promotion.
- Update Goals and Home to show stable destination and today's attention signal
  independently.

**Entry decision:** resolve §8 and §14.1: whether the primary goal is explicitly
selected, inferred until selected, or represented through a lightweight grouping
object. Record the chosen rule before implementation; the current urgency-only
promotion rule cannot coexist ambiguously with a stable primary destination.

**Exit criteria**

- A student with a primary goal sees the same destination remain in the lead
  position on Goals and Home until they change it or its lifecycle makes it
  ineligible.
- The goal with the strongest reason to act today is computed separately as the
  attention signal. When it differs from the primary goal, it appears without
  replacing the primary destination.
- A student with no explicit or inferred primary goal has a defined, consistent
  fallback rather than an accidental urgency-based identity.
- Primary and attention roles change presentation only: every goal remains
  independently scoped, evaluated, achieved, edited, and archived.
- The Home action is still truthful and scoped to the goal it says it advances.

**Enables Phase 4:** real use can reveal whether students naturally understand
several related independent commitments as one plan.

### Phase 4 — evaluate goal plans

- Test whether students naturally want to relate an outcome, routine, and
  performance target.
- If validated, add grouping without combining evaluator or achievement rules.

**Exit criteria**

- Research or observed use establishes that students benefit from seeing related
  independent commitments together, rather than merely needing clearer goal
  cards or a stable primary goal.
- If grouping ships, it preserves each child goal's independent scope,
  evaluator, lifecycle, and achievement condition; a plan is never a blended
  score or a multi-condition goal.
- Plan presentation makes the relationship legible without requiring students
  to classify a newly created goal as primary, supporting, or a measure.

## 13. Success criteria

The experience succeeds when:

- a student can create a meaningful first goal without understanding target
  families or the full Track;
- before saving, they can explain exactly what counts and what completes it;
- cards make current state and next action understandable without opening
  detail;
- students can distinguish a stable destination from something urgent today;
- Home does not unexpectedly change the perceived north star;
- accuracy, speed, and streak goals no longer look like ordinary completion
  counters; and
- starting practice from a goal draws from exactly the material the goal
  measures.

Useful qualitative questions include:

- What are you working toward?
- What do you need to do next?
- What happens if the date passes?
- Why is this goal not complete yet?
- If two goals are visible, which one is your main objective and which one only
  needs attention today?

## 14. Decisions still open

1. Whether the primary goal is explicitly selected, inferred until selected, or
   represented by a lightweight grouping object.
2. Whether any target type is unsuitable as a primary goal.
3. Whether common material selection needs a new simplified component or a
   progressive presentation of the existing Track.
4. Whether creation is a route, sheet, or modal on larger screens; it must remain
   directly addressable and recoverable either way.
5. How an accuracy or speed goal should communicate regression after it was
   achieved while preserving the historical achievement date.
6. Whether supporting commitments share the primary goal's material by default
   or require an explicit relationship.

These questions do not change the central direction: students first state an
intent, the product turns it into one understandable commitment, and the UI
keeps a stable destination distinct from today's urgency.
