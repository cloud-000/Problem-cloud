// Pure logic + data-model types for the multi-select hybrid combobox.
// Kept free of Svelte runtime so it stays simple to reason about and reuse.

export type Option =
    | string
    | { value: string; label: string; disabled?: boolean };

export interface NormalizedOption {
    value: string;
    label: string;
    disabled: boolean;
}

export type ComboboxMatcher = (
    option: NormalizedOption,
    query: string,
) => boolean;

/** Coerce a single option (string shorthand or object) into a normalized shape. */
export function normalizeOption(o: Option): NormalizedOption {
    if (typeof o === "string") {
        return { value: o, label: o, disabled: false };
    }
    return { value: o.value, label: o.label, disabled: o.disabled ?? false };
}

/** Coerce a list of options. */
export function coerceOptions(options: Option[]): NormalizedOption[] {
    return options.map(normalizeOption);
}

/** Default filter: case-insensitive substring match against the label. */
export const defaultMatcher: ComboboxMatcher = (option, query) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase());

/** Default duplicate-detection key: trimmed + lowercased. */
export const defaultDupKey = (s: string): string => s.trim().toLowerCase();

/**
 * Whether focus leaving the control should close the dropdown.
 *
 * Touch taps on a non-focusable option blur the input with `relatedTarget
 * === null`. Closing then unmounts the list before `click` can commit, so
 * callers pass `listPointer` for the duration of a listbox gesture.
 */
export function shouldCloseOnFocusOut(
    relatedTarget: EventTarget | null,
    container: { contains(node: Node): boolean } | null,
    listPointer: boolean,
): boolean {
    if (listPointer) return false;
    if (isNode(relatedTarget) && container?.contains(relatedTarget)) {
        return false;
    }
    return true;
}

function isNode(value: EventTarget | null): value is Node {
    return value != null && typeof (value as Node).nodeType === "number";
}
