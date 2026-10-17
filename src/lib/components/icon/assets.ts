/** Material Symbols instances are generated at maintenance time, never fetched from Google at runtime. */
export type IconAxes = { weight: number; grade: number; opticalSize: number; fill: boolean };
export const DEFAULT_ICON_AXES: IconAxes = { weight: 400, grade: 0, opticalSize: 24, fill: false };

export function iconVariantId({ weight, grade, opticalSize, fill }: IconAxes): string {
    return `w${weight}-g${grade}-o${opticalSize}-f${Number(fill)}`;
}

export function iconHref(name: string, axes: IconAxes): string {
    // A name is one path segment; a malformed name must never become a URL.
    if (!/^[a-z0-9_]+$/.test(name)) return "";
    return `/vendor/material-symbols/${name}.svg#${iconVariantId(axes)}`;
}
