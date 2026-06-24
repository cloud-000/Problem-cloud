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
