/**
 * Placement math for floating surfaces — pure, so it can be unit-tested instead
 * of poked at by hand.
 *
 * Deliberately not AI-aware and deliberately DOM-free: the view measures the
 * anchor and the surface and applies the result, this only decides where the
 * surface goes. Anchored popovers, dropdown menus, and the Coach quick-ask all
 * consume the same function.
 */

export interface FloatingRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface FloatingSize {
    width: number;
    height: number;
}

export interface FloatingViewport {
    width: number;
    height: number;
}

/** Which side of the anchor the surface prefers to sit on. */
export type FloatingSide = "top" | "right" | "bottom" | "left";

/** How the surface lines up with the anchor along the cross axis. */
export type FloatingAlign = "start" | "center" | "end";

export interface PlaceFloatingOptions {
    side?: FloatingSide;
    align?: FloatingAlign;
    /** Distance between the anchor and the surface. */
    gap?: number;
    /** Minimum distance kept from every viewport edge. */
    padding?: number;
    /** Flip to the opposite side (and the opposite alignment) when the preferred one overflows. */
    flip?: boolean;
    /**
     * Anchorless placement only: where the surface sits vertically, as a fraction
     * of the free space. `0` pins it to the top, `0.5` centers it, `1` bottoms it.
     */
    topRatio?: number;
}

export interface FloatingPosition {
    top: number;
    left: number;
    /** The side actually used, or `null` when the surface had no anchor. */
    side: FloatingSide | null;
}

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
};

const isVertical = (side: FloatingSide) => side === "top" || side === "bottom";

function clamp(value: number, size: number, extent: number, padding: number): number {
    // When the surface is larger than the viewport, the upper bound falls below
    // the lower one; pinning to the near edge keeps the overflow off-screen on
    // one side only rather than centering it out of both.
    return Math.max(padding, Math.min(value, extent - size - padding));
}

function fits(
    side: FloatingSide,
    anchor: FloatingRect,
    size: FloatingSize,
    viewport: FloatingViewport,
    gap: number,
    padding: number,
): boolean {
    switch (side) {
        case "top":
            return anchor.top - gap - size.height >= padding;
        case "bottom":
            return anchor.top + anchor.height + gap + size.height <= viewport.height - padding;
        case "left":
            return anchor.left - gap - size.width >= padding;
        case "right":
            return anchor.left + anchor.width + gap + size.width <= viewport.width - padding;
    }
}

function mainAxisOffset(
    side: FloatingSide,
    anchor: FloatingRect,
    size: FloatingSize,
    gap: number,
): number {
    switch (side) {
        case "top":
            return anchor.top - gap - size.height;
        case "bottom":
            return anchor.top + anchor.height + gap;
        case "left":
            return anchor.left - gap - size.width;
        case "right":
            return anchor.left + anchor.width + gap;
    }
}

function alignedOffset(
    align: FloatingAlign,
    anchorStart: number,
    anchorExtent: number,
    surfaceExtent: number,
): number {
    if (align === "center") return anchorStart + (anchorExtent - surfaceExtent) / 2;
    if (align === "end") return anchorStart + anchorExtent - surfaceExtent;
    return anchorStart;
}

function crossAxisOffset(
    align: FloatingAlign,
    anchorStart: number,
    anchorExtent: number,
    surfaceExtent: number,
    viewportExtent: number,
    padding: number,
    flip: boolean,
): number {
    const offset = alignedOffset(align, anchorStart, anchorExtent, surfaceExtent);
    if (!flip || align === "center") return offset;
    // A start-aligned surface that runs off the far edge reads better re-aligned
    // to the anchor's far edge than merely clamped, which would detach it.
    if (align === "start" && offset + surfaceExtent > viewportExtent - padding) {
        return alignedOffset("end", anchorStart, anchorExtent, surfaceExtent);
    }
    if (align === "end" && offset < padding) {
        return alignedOffset("start", anchorStart, anchorExtent, surfaceExtent);
    }
    return offset;
}

/**
 * Where to put a floating surface.
 *
 * Pass `null` for `anchor` when the invocation has none (a keyboard chord):
 * the surface is centered horizontally and placed by `topRatio` vertically.
 */
export function placeFloating(
    anchor: FloatingRect | null,
    size: FloatingSize,
    viewport: FloatingViewport,
    options: PlaceFloatingOptions = {},
): FloatingPosition {
    const {
        side: preferred = "bottom",
        align = "start",
        gap = 4,
        padding = 4,
        flip = true,
        topRatio = 0.5,
    } = options;

    if (!anchor) {
        return {
            top: Math.round(
                clamp((viewport.height - size.height) * topRatio, size.height, viewport.height, padding),
            ),
            left: Math.round(
                clamp((viewport.width - size.width) / 2, size.width, viewport.width, padding),
            ),
            side: null,
        };
    }

    const side =
        flip && !fits(preferred, anchor, size, viewport, gap, padding) &&
        fits(OPPOSITE[preferred], anchor, size, viewport, gap, padding)
            ? OPPOSITE[preferred]
            : preferred;

    const main = mainAxisOffset(side, anchor, size, gap);
    const cross = isVertical(side)
        ? crossAxisOffset(align, anchor.left, anchor.width, size.width, viewport.width, padding, flip)
        : crossAxisOffset(align, anchor.top, anchor.height, size.height, viewport.height, padding, flip);

    const top = isVertical(side) ? main : cross;
    const left = isVertical(side) ? cross : main;

    return {
        top: Math.round(clamp(top, size.height, viewport.height, padding)),
        left: Math.round(clamp(left, size.width, viewport.width, padding)),
        side,
    };
}
