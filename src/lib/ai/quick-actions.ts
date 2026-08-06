import type { AIChatQuickAction } from "$lib/components/ai-chat";

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
