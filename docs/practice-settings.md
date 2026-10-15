# Practice selection and settings

Online practice has one selection path. The former New, Due Review, Skipped,
My list and Mixed modes are no longer user-facing modes.

The shared `PracticeFilters.svelte` appears in the new-session dialog and the
in-session panel. Its sections are:

- **Scope:** topic and series, with division, paper format, problem-number and
  year constraints attached to their own series.
- **Your history:** previous attempts, mastery, and last submission. The optional
  More history filters disclosure holds personal status, last graded result,
  correct/skipped/logged-submission counts, and ordering.
- **Session options:** difficulty, problem requirements, and timing/behavior.
  It is collapsed initially. The existing combobox, select, switch, tri-state
  switch and slider components are reused.

## History semantics

Previous attempts uses `problem_progress.times_reviewed`: one per recorded,
graded, non-skipped submission, including the initial attempt and mock tests.
Intermediate answer retries are not separate attempts. Never attempted means
zero; At least once means one or more; Custom range edits the same count filter,
not an additional constraint. Custom-range fields keep a text draft while focused
and validate on blur; invalid entries restore the previous bound. An empty minimum
commits as zero and an empty maximum as unlimited. Ungraded submissions do not
increment this count.

Last submission uses `last_submission_at`, including skips and ungraded
submissions. Within the last N days includes timestamps at or after the cutoff.
No submission in the last N days accepts timestamps before the cutoff or null
(no submission). Thus a skipped-only problem has zero graded attempts but a
submission date. Mastery choices are OR-ed together; separate filters are AND-ed.

Defaults impose no history/mastery/date restriction. Ignored is excluded unless
explicitly selected. Random is the default order; least recent submission first
is available. The Review shortcut uses at least one attempt, no submission in the
last seven days, and least recent submission first. Every field remains editable.

## Selection and persistence

`trainer.ts` filters `user_problem_index` before counting or paging and loads the
selected problems with their shared canonical progress. A scoped draw can use an
alias placement to match that placement's series/year/number. Session exclusions
include canonical identity so another placement cannot repeat the same problem.
Unscoped discovery uses canonical rows only. Malformed statements/reference keys
are skipped without stopping discovery of subsequent eligible candidates.

Adaptive difficulty remains a soft preference: try the rating band, then the
nearest matching rating, then a draw without a rating band. It never drops explicit
history, scope or problem requirements. Manual difficulty remains a hard filter.
SM-2 scheduling is still updated by the database, but `next_review_at` does not gate
practice selection. Progress keeps its scheduled reminders in a secondary disclosure.

New JSON snapshots carry `historyVersion: 1`. `mode: "new"` is retained only for
legacy/download compatibility; it is not an online selection instruction. On
resume, snapshots without the version translate old modes into explicit filters:
New to zero attempts; Review to at least one attempt and the seven-day window;
Skipped to skipped and never-correct; My list to its personal status; Mixed to any
history. Existing recency windows retain their original Within interpretation.

Guest/downloaded practice retains its existing data-source limits. Unsupported
history controls are disabled with an explanation, rather than implying that
account-wide filtering is available offline. Test format retains its fixed test
sequence and test-specific timing controls.
