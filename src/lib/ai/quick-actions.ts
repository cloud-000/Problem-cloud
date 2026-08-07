import type { AIChatQuickAction } from "$lib/components/ai-chat";
import type { CoachQuickAction } from "./types";

/**
 * What a surface with a problem in front of it offers — the trainer and the library's
 * ask-about-this action.
 *
 * Shared for the same reason as the fallback set below: these lived inline in both
 * surfaces and had already drifted apart in the wording of "Explain this", which is the
 * kind of difference nobody notices until the two are read side by side.
 */
export const PROBLEM_QUICK_ACTIONS: readonly CoachQuickAction[] = [
    {
        id: "hint",
        label: "Give me a hint",
        prompt: "Give me the smallest hint that gets me unstuck on this problem.",
        icon: "lightbulb",
    },
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
