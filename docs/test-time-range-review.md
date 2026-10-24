# Test review: consecutive problem time range

## Status

Implemented in the completed test review (`TestResults.svelte`). Range selection
is transient and uses the ordered review history and recorded per-problem times.
The sample-data demo uses the same review navigation and selection logic at
[`src/routes/(app)/testing-features/test-time-range/+page.svelte`](../src/routes/%28app%29/testing-features/test-time-range/%2Bpage.svelte).

## Goal

Let a student reviewing a completed test quickly answer:

- How much time did I spend on problems **A through B**, inclusive?
- Which problems in that stretch took the most time?

The selected problems must form one consecutive span in the test's original
order. The interaction should fit into the existing test review without adding
a permanent toolbar or changing what an ordinary click/tap does.

## Desired behavior

### Selecting a range

- A normal click or tap keeps its current meaning: navigate to or preview that
  problem.
- On touch screens, press and hold a problem number to set a range endpoint.
  The first hold sets the start. A second hold sets the end. Further holds on unselected problems move
  the end while keeping the start fixed.
- Repeating the selection gesture on any selected problem (either endpoint or
  an interior problem) toggles the range off. This applies to touch holds,
  Shift-click, and the keyboard alternative.
- On desktop, Shift-click sets the first endpoint and then the second/movable
  endpoint. Shift-click was chosen over right-click because right-click is
  associated with the browser context menu.
- Keyboard users can focus a problem number and use Shift+Enter or Shift+Space
  to set an endpoint. Escape clears the range.
- Starting the range at a later problem and ending at an earlier one still
  selects the inclusive span between them. Display endpoints in ascending test
  order.
- A one-endpoint selection represents a one-problem range until a second
  endpoint is set.

### Showing the result

- Highlight the selected problems in the existing problem-number navigation and
  time-per-problem visualization.
- Show a compact summary with the range (for example, **Problems 8–14**), number
  of included problems, total recorded time, and optionally average time per
  problem.
- Keep per-problem times visible so the student can see how the total is
  distributed.
- Use the sum of recorded per-problem elapsed times as the range total. This is
  active recorded problem time; it may differ from wall-clock time between the
  start of A and finish of B when the test was paused or left idle.
- Include every test problem between the endpoints, including skipped,
  unanswered, or ungraded items. A missing/zero duration should remain visible
  as zero or unavailable and must not silently exclude that problem from the
  range count.

## Interaction feel and constraints

- Keep the gesture secondary: normal tap/click remains fast and predictable.
- Give the held cell a visible progress/pressed state while the hold is pending,
  then mark the endpoint when the hold completes.
- A touch that moves enough to become a scroll must cancel the pending hold.
  Do not disable vertical scrolling across the results page to implement this
  feature. Browser `pointercancel` should also cancel a pending hold.
- Suppress the click generated after a successful long press so one hold cannot
  both set an endpoint and trigger normal problem navigation.
- Keep targets comfortably tappable and ensure endpoint/range state is conveyed
  with more than color alone (for example, endpoint dots plus an outline).
- Provide a brief discoverability hint, preferably near the existing time
  summary or on first use, such as “Shift-click or press and hold to select a
  range.” Avoid a permanent selection-mode control unless usability feedback
  shows the gesture is too hard to discover.
- The long-press threshold and movement tolerance in the prototype are
  experiments, not final product requirements.

## Data and current app structure

The completed test review already has per-problem elapsed time in its history
entries and displays a time-per-problem graph. Relevant existing code:

- [`TestResults.svelte`](../src/routes/%28app%29/practice/TestResults.svelte) renders
  the sticky test summary, problem navigation, time graph, and problem reviews.
- [`test-state.ts`](../src/routes/%28app%29/practice/test-state.ts) rebuilds test
  review history from recorded submissions, including each entry's
  `elapsedMs`.
- [`test-time-range/+page.svelte`](../src/routes/%28app%29/testing-features/test-time-range/%2Bpage.svelte)
  is a sample-data demo using `ReviewProblemNavigation.svelte` and the same
  selection helpers as production. The shared `ProblemGrid` is unchanged.
- `ReviewProblemNavigation.svelte` owns the review-only navigation presentation;
  `test-time-range-gesture.ts` handles cancellable touch holds and suppresses the
  resulting click until it arrives, without a release-time deadline.
- `test-time-range.ts` owns endpoint selection and inclusive recorded-time sums.

An implementation should use the test review's ordered history and recorded
elapsed times; it should not introduce a second timer or persist range
selection. Prefer keeping any gesture handling scoped to test review unless a
separate use case justifies a reusable component change.

## Acceptance criteria

1. A normal click/tap still navigates to the chosen problem.
2. Touch hold, Shift-click, and the documented keyboard alternative can select
   an inclusive consecutive range.
3. Scrolling on touch cancels a pending hold and remains natural.
4. The range summary and per-problem visualization update immediately when an
   endpoint is selected or moved.
5. Total time equals the sum of the included problems' recorded elapsed times;
   skipped and zero-time entries remain part of the range.
6. The range can be cleared without changing test answers or recorded results.

## Initial implementation choices

- Selecting any active problem again clears the range, including a single-endpoint range.
  A clear button appears only while a range is active; Escape also clears it.
- The compact summary shows count and recorded total. The graph highlights the
  span and lists the selected per-problem times, including zero-time entries.
- Touch holds use 500 ms and a 12 px movement tolerance. These still need device
  testing for feel. Native scrolling remains enabled on navigation and graph.
- Selection lasts only for the mounted review; it is never saved or sent to the
  database. Average time is omitted initially.

## Open product questions

- Should the range average be shown in the initial version, or is total plus the
  per-problem breakdown enough?
- What exact hold duration and movement tolerance feel right on iOS Safari,
  Android Chrome, and tablets?
- Should a selection persist only until leaving test review, or survive a page
  refresh? The prototype is transient; persistence is not currently needed for
  the core task.
