export const CONTEXT_POLICIES = ["coaching", "test-locked", "assist"] as const;

/**
 * The surface's context stance. The prose each policy contributes to the system prompt
 * lives with the rest of the model-facing vocabulary in `$lib/ai/prompt.ts`; this module
 * is the type only.
 */
export type Policy = (typeof CONTEXT_POLICIES)[number];
