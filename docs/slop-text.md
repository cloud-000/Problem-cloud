# Slop Text

Tautological or obvious-state UI copy that restates the heading, control, or visible state without adding information. It raises cognitive load and slows progress. Remove on sight.

## Definition

Text is slop if it meets any of these:

1. **Restates the heading** — `Library` / "Search the collection, explore archives…"; `Goals` / "A commitment to reach a stated finish line…"; `Appearance` / "Choose how ProblemCloud looks…"
2. **Narrates the control** — toggle `Unlimited time` with sub-label `No time limit`; `Verified only: Verified`; placeholder `Enter ids` on an ID box.
3. **Narrates visible state** — "Downloaded and ready for offline use" under a full progress bar; prose summary duplicating chips above it; "Pick up where you left off" under `Continue`.
4. **Three-verb marketing list** — "Understand what needs attention, review your work, and follow your development…" (just lists the tabs below).
5. **Hedge / filler** — "Start solving now.", "when you are ready", "Are you absolutely sure…?", "Same filters as practice."

Not slop: facts with denominators, mechanics, consequences, or destinations (`Review due (3)`, `Saved in this browser only`, `This action … will delete all votes`, `Resume AMC 12 set`).

## Process

1. **Find the file, read fully.** Headers (`Page.Header title + description`), section subtitles, toggle sub-captions, modal intros, empty states, placeholders.
2. **Check the control.** If `description` is optional (it is on `page-header.svelte` / `page-section.svelte`), delete the prop entirely — never leave an empty string or empty `<p>`.
3. **Delete, don't rephrase.** Most slop has no replacement. Exceptions: keep the informative half (`1, 2, 3` from `Enter ids, e.g. 1, 2, 3`; `Vote for the work…` from the roadmap header; `Asymptote diagrams adjust contrast…` from Appearance).
4. **Fix duplications once.** Heading carries the count *or* the button does, never both (`Review due (3)` + bare `Open Review`). One signup pitch per page. One `History` header per page.
5. **Verify.** `bun run check` (0 errors) + `bun test` (1382 pass). No empty elements, no dangling props.

## History

2026-10-02: full sweep, 31 files, +53 / −170. See git log for that date for examples.
