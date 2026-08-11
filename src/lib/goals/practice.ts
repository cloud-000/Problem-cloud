/**
 * The practice handoff: a goal's scope, handed to the trainer unchanged.
 *
 * This is the payoff of `GoalScope` being structurally the practice `TrackValue`
 * (`docs/goals.md` §3) — the three scope axes cross over by assignment, and the
 * only thing this module decides is *which* problems in that scope still count
 * as remaining, expressed in the draw filters the trainer already has.
 *
 * Deliberately NOT re-exported from `index.ts`: the domain layer knows nothing
 * about the trainer, and putting `PracticeSettings` in the barrel would make
 * "what is a goal" answerable only with the practice module loaded. Import it
 * as `$lib/goals/practice` — the deeper path is the layering, made visible.
 */

import { targetOf } from "./registry";
import type { Goal, GoalScope } from "./types";
import { defaultPracticeSettings, type PracticeSettings } from "$lib/trainer";

/** Deep-clone the per-series map so a live goal and a stored session snapshot
 * never share arrays. */
function cloneScopes(scope: GoalScope): PracticeSettings["seriesScopes"] {
    const out: NonNullable<PracticeSettings["seriesScopes"]> = {};
    for (const [id, entry] of Object.entries(scope.seriesScopes ?? {})) {
        out[id] = {
            divisions: [...(entry?.divisions ?? [])],
            formats: [...(entry?.formats ?? [])],
        };
    }
    return out;
}

/**
 * Practice settings that draw only what the goal still needs.
 *
 * Per family, because "remaining" is a different set for each:
 *
 *   * **attempted** — problems with no graded attempt at all, which is exactly
 *     the new-problem draw;
 *   * **solved** — anything not yet solved, so the new draw *and* the review
 *     queue, with the review side held to `times_correct = 0` so a solved
 *     problem can never come back as "remaining";
 *   * **volume, accuracy, speed, streak** — event families have no remaining
 *     set: any work in scope moves them. Mixed practice in the goal's scope is
 *     the honest reading, and narrowing it further would count work the goal
 *     itself does not.
 *
 * An unreadable target (a hand-edited `type`) falls through to the last case:
 * practising the scope is always defensible, inventing a filter is not.
 */
export function practiceSettingsForGoal(
    goal: Pick<Goal, "scope" | "target">,
): PracticeSettings {
    const base: PracticeSettings = {
        ...defaultPracticeSettings(),
        topic: [...(goal.scope.topic ?? [])],
        seriesIds: [...(goal.scope.seriesIds ?? [])],
        seriesScopes: cloneScopes(goal.scope),
    };

    const target = targetOf(goal.target);
    switch (target?.type) {
        case "attempted_count":
        case "attempted_percent":
            return { ...base, mode: "new" };
        case "solved_count":
        case "solved_percent":
            return { ...base, mode: "mixed", timesCorrect: [0, 0] };
        default:
            return { ...base, mode: "mixed" };
    }
}

/** Session name for the handoff. Sessions are how a student finds their way
 * back, so it names the goal rather than the filters. */
export function practiceSessionName(goal: Pick<Goal, "title">): string {
    const name = `Goal: ${goal.title}`;
    return name.length > 80 ? `${name.slice(0, 79)}…` : name;
}

/**
 * Whether the button should say "practice what's left" or just "practice".
 * Only the set family has a remaining set to drain (§4).
 */
export function hasRemainingSet(goal: Pick<Goal, "target">): boolean {
    const type = targetOf(goal.target)?.type;
    return (
        type === "attempted_count" ||
        type === "attempted_percent" ||
        type === "solved_count" ||
        type === "solved_percent"
    );
}
