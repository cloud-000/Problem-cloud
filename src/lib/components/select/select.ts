// Pure logic + data-model types for the Select component.
// Kept free of Svelte runtime so it stays simple to reason about and reuse.

export type SelectOption =
    | string
    | { value: string; label: string; disabled?: boolean };

export interface NormalizedSelectOption {
    value: string;
    label: string;
    disabled: boolean;
}

/** Coerce a single option (string shorthand or object) into a normalized shape. */
export function normalizeOption(o: SelectOption): NormalizedSelectOption {
    if (typeof o === "string") {
        return { value: o, label: o, disabled: false };
    }
    return { value: o.value, label: o.label, disabled: o.disabled ?? false };
}

/** Coerce a list of options. */
export function coerceOptions(options: SelectOption[]): NormalizedSelectOption[] {
    return options.map(normalizeOption);
}
