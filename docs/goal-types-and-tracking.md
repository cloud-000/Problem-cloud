# Kinds of goals

> Status: product catalog. What a student can commit to, and what each kind of
> commitment actually rewards. The rules that govern all goals live in
> [`goals.md`](./goals.md); the mechanism for adding a new kind lives in
> [`goal-target-architecture.md`](./goal-target-architecture.md).

Students preparing for AMC, AIME and MathCounts arrive with different problems
to solve. Someone six months out needs breadth. Someone two weeks out needs a
score. Someone who keeps dropping easy problems needs precision, not more
material. A goal is only useful if it rewards the behaviour that student
actually needs — so the catalog is organized by intent, not by metric.

Six kinds ship in V1. Two more are described at the end because students clearly
want them, but they are not yet definable.

---

## Coverage — "I want to have seen all of it"

> *Attempt 80% of the problems in AMC 10 geometry.*

The student is exploring unfamiliar territory and wants no blind spots. Every
eligible problem counts once, the first time it is genuinely attempted. Getting
it wrong still counts — the commitment is to face the material, not to conquer it.

**Rewards:** breadth, and finishing what you started.
**Does not reward:** learning. A student can complete a coverage goal having
solved almost nothing. That is a real limitation, not a flaw — coverage is the
right goal early, when the point is finding out what you don't know.
**Pairs well with:** a Solve goal over the same scope, set afterwards.

---

## Solve — "I want to actually be able to do it"

> *Solve 100 problems in AMC 12 number theory.*

The stricter sibling of coverage: a problem counts only once the student has
gotten it right. Same material, higher bar.

This is what most students mean when they say "master" a topic, and unlike a
self-rating it cannot be completed by declaring yourself confident.

**Rewards:** genuine capability on distinct problems.
**Does not reward:** retention. Solving something once in March says little about
March next year — see *Retention* below.
**Pairs well with:** following a completed coverage goal on the same scope.

---

## Volume — "I want to put in the reps"

> *Do 150 problems this month.*

A work quota. Unlike coverage and solve, **repeats count** — attempting the same
problem three times is three problems' worth of work, because the commitment is
about effort spent, not ground covered.

**Rewards:** showing up and doing the work, which is often the honest bottleneck.
**Does not reward:** difficulty or care. A student can grind easy problems, or
guess quickly, and hit the number.
**Pairs well with:** an Accuracy goal, which is the natural counterweight.

---

## Accuracy — "I keep making silly mistakes"

> *Get 85% right on my next 30 fresh problems in algebra.*

For the student who understands the material but bleeds points to arithmetic and
misreadings. Measured over the most recent stretch of work, so it reflects
current form rather than a lifetime average that can never move.

Two properties matter and both are deliberate. Only a problem's **first** attempt
counts, so re-doing problems you have already seen cannot inflate the number.
And below the sample size the goal reports *not enough data yet* rather than a
percentage — seven problems is not a form reading.

**Rewards:** precision on unfamiliar problems.
**Does not reward:** progress. Accuracy goes down as well as up, and a student
who moves to harder material will watch it fall for good reasons.
**Pairs well with:** Speed, which it keeps honest.

---

## Speed — "I need to be faster"

> *Average under 90 seconds on AMC 10 problems 1–15.*

Time management: getting through the early problems fast enough to have time for
the late ones. Measured only over problems the student got **right**, and every
speed goal carries a minimum accuracy alongside it.

That accuracy floor is not optional. "Faster" is trivially achieved by guessing,
and a speed goal without a correctness condition rewards exactly that — which is
the opposite of the behaviour the student wants.

**Rewards:** fluency on material already understood.
**Does not reward:** anything on unfamiliar material, where slowing down is
correct.
**Pairs well with:** a scope narrowed to problems the student can already solve.

---

## Consistency — "I want to stop cramming"

> *Practice at least 3 problems a day for 30 days.*

A habit rather than an outcome. The student is not trying to reach a number in
the catalog; they are trying to become someone who practises.

Days are counted in the timezone where the goal was created, so travelling does
not silently break or extend a streak.

**Rewards:** regularity, which is what most preparation plans actually fail at.
**Does not reward:** depth or volume. Three easy problems a day satisfies it.
**Pairs well with:** almost anything — it is about when a student works, while
every other kind is about what they work on.

---

## Choosing between the close ones

The three that get confused are Coverage, Solve and Volume. The difference is
what a repeated attempt is worth:

| | Attempt a new problem | Get it right | Attempt it again |
| --- | --- | --- | --- |
| **Coverage** | counts | — | nothing |
| **Solve** | nothing | counts | nothing |
| **Volume** | counts | — | counts again |

A rough sequence for a student working through unfamiliar material: **Coverage**
to find the gaps, **Solve** to close them, **Accuracy** to sharpen, **Speed**
last. **Volume** and **Consistency** run alongside any of them.

---

## Not yet available

Both of these are things students ask for. Neither is dishonest to want — they
are just not yet defined well enough to promise.

**Contest score.** *"Score 100 on three AMC 10 mocks."* The most direct
expression of what a competitor wants. It needs a scoring model that differs by
contest, plus decisions about timed versus untimed sittings, abandoned tests, and
whether retaking a paper you have seen counts. Until those are settled, a score
goal would report a number nobody could interpret.

**Retention.** *"Still be able to solve these in three months."* The honest
version of "mastery" — not solving something once, but still solving it after a
gap. It needs credible rules for how long a gap has to be, and what a later miss
does to a problem already counted. A goal built on self-rating is not a
substitute: a commitment you complete by clicking is not a commitment.

---

## What every goal shares

Regardless of kind, a goal has a name, a scope of material, a finish line, and an
optional deadline. Achievement is permanent — later changes to the catalog, or a
form dip after the fact, never retract it. A deadline is a horizon, not a failure
condition. Full rules in [`goals.md`](./goals.md).
