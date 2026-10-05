import type { RGB } from "$lib/asy/scene";
import { hexToRGB } from "$lib/asy/editor-properties";

/**
 * Ink inversion, single-sourced.
 *
 * The canvas remaps authored ink per theme (black follows the theme
 * foreground; paper-white maps to inverse ink in dark mode), while the
 * property-card swatches and the toolbar dot used to paint raw authored hex —
 * so the picker showed one color and the canvas painted another. Everything
 * ink-related now flows through this module:
 *
 * - `resolveInkColor` — authored rgb → the color the canvas paints. Used by
 *   `penStroke` in `render.ts` (and therefore canvas, SVG, and PNG export).
 * - `previewSwatchColor` — authored hex → the same mapping, for swatch chips.
 * - `themePalette` / `themeInk` — the Theme → palette token mapping, so the
 *   token names and fallbacks live here rather than in each component.
 */

export interface WhiteboardPalette {
    background: string;
    foreground: string;
    inverseInk: string;
    border: string;
    primary: string;
    isDark: boolean;
}

/** The slice of the palette a swatch preview needs. */
export interface WhiteboardInkTheme {
    foreground: string;
    inverseInk: string;
    isDark: boolean;
}

const EPSILON = 1e-4;

function isBlack(rgb: RGB): boolean {
    return rgb.r <= EPSILON && rgb.g <= EPSILON && rgb.b <= EPSILON;
}

function isWhite(rgb: RGB): boolean {
    return rgb.r >= 1 - EPSILON && rgb.g >= 1 - EPSILON && rgb.b >= 1 - EPSILON;
}

/**
 * Map authored ink to the color the canvas paints: black follows the theme
 * foreground, paper-white maps to inverse ink in dark mode, and everything
 * else paints authored. Absent ink (the default pen) is foreground ink.
 */
export function resolveInkColor(
    rgb: RGB | undefined,
    ink: WhiteboardInkTheme,
): string {
    if (rgb === undefined) return ink.foreground;
    if (isBlack(rgb)) return ink.foreground;
    if (isWhite(rgb) && ink.isDark) return ink.inverseInk;
    return `rgb(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)})`;
}

/**
 * What a swatch chip must show so the picker matches the canvas: the same
 * mapping as `resolveInkColor`, from authored hex.
 */
export function previewSwatchColor(hex: string, ink: WhiteboardInkTheme): string {
    return resolveInkColor(hexToRGB(hex), ink);
}

/**
 * Read the ink-relevant theme values. `current` / `light` are the theme
 * records (`Theme.currentTheme?.theme` and the `light` preset's).
 */
export function themeInk(
    current: Record<string, string> | undefined,
    light: Record<string, string> | undefined,
    isDark: boolean,
): WhiteboardInkTheme {
    return {
        foreground: current?.foreground ?? "#191c1e",
        inverseInk: light?.foreground ?? "#191c1e",
        isDark,
    };
}

/** The full canvas palette from the same theme records. */
export function themePalette(
    current: Record<string, string> | undefined,
    light: Record<string, string> | undefined,
    isDark: boolean,
): WhiteboardPalette {
    return {
        ...themeInk(current, light, isDark),
        background: current?.["surface-container-lowest"] ?? "#ffffff",
        border: current?.border ?? "#e2e8f0",
        primary: current?.["primary-foreground"] ?? "#326cec",
    };
}
