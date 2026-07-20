export type ToolbarPosition = { left: number; top: number };

/** Keep a center-positioned floating toolbar fully inside its whiteboard. */
export function clampToolbarPosition(
    position: ToolbarPosition,
    board: { width: number; height: number },
    toolbar: { width: number; height: number },
    margin = 8,
): ToolbarPosition {
    const halfWidth = Math.min(toolbar.width / 2, Math.max(0, board.width / 2 - margin));
    const minLeft = margin + halfWidth;
    const maxLeft = Math.max(minLeft, board.width - margin - halfWidth);
    const minTop = margin;
    const maxTop = Math.max(minTop, board.height - margin - toolbar.height);

    return {
        left: Math.max(minLeft, Math.min(maxLeft, position.left)),
        top: Math.max(minTop, Math.min(maxTop, position.top)),
    };
}
