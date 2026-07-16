export type ResizeEdge = "left" | "right" | "top" | "bottom";

export interface PanelSize {
    width?: number;
    height?: number;
}

export interface PanelSizeConstraints {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
}

export interface CollapsibleDimensions {
    width?: boolean;
    height?: boolean;
    thresholdRatio?: number;
}

export function clampDimension(
    value: number | undefined,
    min = 0,
    max = Number.POSITIVE_INFINITY,
): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    return Math.min(Math.max(value, min), Math.max(min, max));
}

export function clampPanelSize(
    size: PanelSize,
    constraints: PanelSizeConstraints,
): PanelSize {
    return {
        width: clampDimension(size.width, constraints.minWidth, constraints.maxWidth),
        height: clampDimension(size.height, constraints.minHeight, constraints.maxHeight),
    };
}

export function mergePanelSize(previous: PanelSize, next: PanelSize): PanelSize {
    return {
        width: next.width ?? previous.width,
        height: next.height ?? previous.height,
    };
}

export function resizePanel(
    start: PanelSize,
    deltaX: number,
    deltaY: number,
    edges: readonly ResizeEdge[],
    constraints: PanelSizeConstraints,
    collapsible: CollapsibleDimensions = {},
): PanelSize {
    let width = start.width;
    let height = start.height;

    if (width !== undefined) {
        if (edges.includes("left")) width -= deltaX;
        else if (edges.includes("right")) width += deltaX;
    }
    if (height !== undefined) {
        if (edges.includes("top")) height -= deltaY;
        else if (edges.includes("bottom")) height += deltaY;
    }

    const collapseThresholdRatio = Math.min(
        1,
        Math.max(0, collapsible.thresholdRatio ?? 0.5),
    );
    const collapseWidth =
        collapsible.width &&
        width !== undefined &&
        constraints.minWidth !== undefined &&
        width < constraints.minWidth * collapseThresholdRatio;
    const collapseHeight =
        collapsible.height &&
        height !== undefined &&
        constraints.minHeight !== undefined &&
        height < constraints.minHeight * collapseThresholdRatio;
    const clamped = clampPanelSize({ width, height }, constraints);
    return {
        width: collapseWidth ? 0 : clamped.width,
        height: collapseHeight ? 0 : clamped.height,
    };
}

export function parsePersistedPanelSize(
    value: string | null,
    fallback: PanelSize,
    constraints: PanelSizeConstraints,
): PanelSize {
    if (!value) return clampPanelSize(fallback, constraints);
    try {
        const parsed = JSON.parse(value) as PanelSize;
        return clampPanelSize(
            {
                width: Number.isFinite(parsed?.width) ? parsed.width : fallback.width,
                height: Number.isFinite(parsed?.height) ? parsed.height : fallback.height,
            },
            constraints,
        );
    } catch {
        return clampPanelSize(fallback, constraints);
    }
}

export function serializePanelSize(size: PanelSize): string | null {
    const serializable: PanelSize = {};
    if (Number.isFinite(size.width)) serializable.width = size.width;
    if (Number.isFinite(size.height)) serializable.height = size.height;
    return serializable.width === undefined && serializable.height === undefined
        ? null
        : JSON.stringify(serializable);
}
