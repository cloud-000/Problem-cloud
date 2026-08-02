import type { WhiteboardToolKind } from "$lib/state/whiteboard.svelte";

export interface WhiteboardInspectorContext {
    toolKind: WhiteboardToolKind;
    inspectorProperties: readonly unknown[];
    selectedDimensionId: string | null;
}

/** Whether the current tool or selection has meaningful inspector controls. */
export function hasWhiteboardInspector(context: WhiteboardInspectorContext): boolean {
    if (context.toolKind === "pan") return false;
    return context.selectedDimensionId !== null || context.inspectorProperties.length > 0;
}
