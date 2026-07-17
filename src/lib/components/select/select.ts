// Pure logic + data-model types for the Select component.
// Kept free of Svelte runtime so it stays simple to reason about and reuse.

export type SelectOption =
    | string
    | { value: string; label: string; disabled?: boolean; group?: string };

export interface NormalizedSelectOption {
    value: string;
    label: string;
    disabled: boolean;
    /** Section heading this option belongs under. Ungrouped options render headerless. */
    group?: string;
}

/** A run of options sharing a heading. `label` is undefined for ungrouped options. */
export interface SelectSection {
    label: string | undefined;
    /** `index` is the option's position in the *visible* list, which is what
     * keyboard navigation and `aria-activedescendant` address. */
    options: { option: NormalizedSelectOption; index: number }[];
}

/** Coerce a single option (string shorthand or object) into a normalized shape. */
export function normalizeOption(o: SelectOption): NormalizedSelectOption {
    if (typeof o === "string") {
        return { value: o, label: o, disabled: false };
    }
    return { value: o.value, label: o.label, disabled: o.disabled ?? false, group: o.group };
}

/** Coerce a list of options. */
export function coerceOptions(options: SelectOption[]): NormalizedSelectOption[] {
    return options.map(normalizeOption);
}

/**
 * Every whitespace-separated token must appear in the label or the value, so "gpt 4o"
 * finds "GPT-4o" and a user who knows the raw id can type it instead of the label.
 */
export function matchesQuery(option: NormalizedSelectOption, query: string): boolean {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const haystack = `${option.label} ${option.value}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
}

export function filterOptions(
    options: NormalizedSelectOption[],
    query: string,
): NormalizedSelectOption[] {
    return options.filter((option) => matchesQuery(option, query));
}

/**
 * Bucket options into sections, preserving first-seen group order rather than sorting:
 * the caller's order is meaningful (e.g. a recommended option first). Non-adjacent
 * options sharing a group join the same section.
 */
export function groupOptions(options: NormalizedSelectOption[]): SelectSection[] {
    const sections: SelectSection[] = [];
    const byLabel = new Map<string | undefined, SelectSection>();
    options.forEach((option, index) => {
        let section = byLabel.get(option.group);
        if (!section) {
            section = { label: option.group, options: [] };
            byLabel.set(option.group, section);
            sections.push(section);
        }
        section.options.push({ option, index });
    });
    return sections;
}
