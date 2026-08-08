import type { AIChatQuickAction } from "$lib/components/ai-chat";
import { HINT_LADDER } from "./hints";
import type { CoachQuickAction } from "./types";

/**
 * The problem-surface actions that are *not* hints, kept separate because the trainer
 * composes them with a ladder rung of its own (`hintQuickAction`) rather than with the
 * flat hint below. Splitting them is what stops the trainer from growing a second
 * hand-written copy of "Check my approach".
 */
export const PROBLEM_SUPPORT_ACTIONS: readonly CoachQuickAction[] = [
    {
        id: "approach",
        label: "Check my approach",
        prompt: "Here is my approach so far — tell me whether it can work, without solving it for me.",
        icon: "checklist",
    },
    {
        id: "explain",
        label: "Explain this",
        prompt:
            "Explain what this problem is asking and which ideas may be relevant, without giving away the solution.",
        icon: "help",
    },
];

/**
 * What a surface with a problem in front of it offers — the library's ask-about-this
 * action, and any Coach presentation that is looking at a problem without tracking a
 * hint level of its own.
 *
 * Shared for the same reason as the fallback set below: these lived inline in both
 * surfaces and had already drifted apart in the wording of "Explain this", which is the
 * kind of difference nobody notices until the two are read side by side.
 */
export const PROBLEM_QUICK_ACTIONS: readonly CoachQuickAction[] = [
    // The ladder's shallowest rung, so a surface that offers one flat hint asks for
    // exactly what the trainer's first press asks for. Only the trainer tracks a
    // level, so everywhere else this is where the ladder both starts and ends.
    {
        id: "hint",
        label: HINT_LADDER[0].escalatingLabel,
        prompt: HINT_LADDER[0].prompt,
        icon: "lightbulb",
    },
    ...PROBLEM_SUPPORT_ACTIONS,
];

/**
 * What an unanchored Coach offers when the surface it is shown on registered no
 * quick actions of its own — the panel and the `/coach` page, both of which open
 * onto nothing in particular. A surface with something in front of it (the trainer,
 * the library) publishes its own through the context registry, and those win.
 *
 * Shared rather than restated per surface: two copies of the same three prompts
 * drift, and the drift is invisible until someone reads them side by side.
 */
export const COACH_FALLBACK_QUICK_ACTIONS: readonly AIChatQuickAction[] = [
    {
        id: "find",
        label: "Find problems for me",
        prompt: "Help me find problems to practice.",
    },
    {
        id: "progress",
        label: "Summarize my progress",
        prompt: "Help me think about my recent progress.",
    },
    {
        id: "plan",
        label: "Plan a study session",
        prompt: "Help me plan a focused study session.",
    },
];
