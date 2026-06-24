<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import type { Snippet } from "svelte";
    import { tv } from "tailwind-variants";
    import {
        type ComboboxMatcher,
        type NormalizedOption,
        type Option,
    } from "./combobox.js";

    export const comboboxVariants = tv({
        base: "border-input focus-within:border-ring focus-within:ring-ring/50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive relative w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-within:ring-3 aria-invalid:ring-3 has-disabled:pointer-events-none has-disabled:opacity-50 cursor-text",
    });

    export type ComboboxProps = WithElementRef<
        Omit<HTMLAttributes<HTMLDivElement>, "onchange">,
        HTMLDivElement
    > & {
        /** Bindable selected values — source of truth for the pills. */
        value?: string[];
        /** Bindable inline query text. */
        query?: string;
        /** Bindable open state of the dropdown. */
        open?: boolean;
        /** Predefined options. Omit / empty => freestyle mode (no dropdown). */
        options?: Option[];
        /** Strict mode: custom text never becomes a pill. Ignored in freestyle. */
        strict?: boolean;
        /** Filter predicate. Default = case-insensitive substring on label. */
        matcher?: ComboboxMatcher;
        /** Duplicate-detection normalizer. Default = trim + lowercase. */
        dupKey?: (raw: string) => string;
        /** Characters that commit the current query (non-strict / freestyle). */
        separators?: string[];
        /** Placeholder shown when no pills are selected (empty state). */
        placeholder?: string;
        /** Placeholder shown in the text field once pills exist (e.g. "Add more…"). */
        inputPlaceholder?: string;
        disabled?: boolean;
        /** Cap the number of selections. */
        max?: number;
        "aria-invalid"?: boolean | "true" | "false" | null;
        /** Fired after value mutates (commit or remove). */
        onchange?: (values: string[]) => void;
        /** Fired when a bespoke (off-list) pill is created. */
        oncreate?: (value: string) => void;
        /** Override pill rendering. Receives the option and a remove() callback. */
        pill?: Snippet<[NormalizedOption, () => void]>;
        /** Override option-row rendering. Receives the option and isActive. */
        optionItem?: Snippet<[NormalizedOption, boolean]>;
        /** Override the "Nothing found" row. */
        empty?: Snippet<[]>;
        /** Override the "Nothing left" row. */
        exhausted?: Snippet<[]>;
    };

    export {
        type Option,
        type NormalizedOption,
        type ComboboxMatcher,
    } from "./combobox.js";
</script>

<script lang="ts">
    import {
        coerceOptions,
        defaultMatcher,
        defaultDupKey,
    } from "./combobox.js";
    import { Button } from "$lib/components/button/index.js";
    import { Icon } from "$lib/components/icon/index.js";

    let {
        ref = $bindable(null),
        class: className,
        value = $bindable([]),
        query = $bindable(""),
        open = $bindable(false),
        options = [],
        strict = false,
        matcher = defaultMatcher,
        dupKey = defaultDupKey,
        separators = [","],
        placeholder,
        inputPlaceholder,
        disabled = false,
        max,
        "aria-invalid": ariaInvalid = null,
        "data-slot": dataSlot = "combobox",
        onchange,
        oncreate,
        pill,
        optionItem,
        empty,
        exhausted,
        ...restProps
    }: ComboboxProps = $props();

    // --- ARIA id namespace (SSR-safe, hydration-stable) ---
    const uid = $props.id();
    const listboxId = `${uid}-listbox`;
    const liveId = `${uid}-live`;
    const rowId = (i: number) => `${uid}-row-${i}`;

    // --- internal state ---
    let activeIndex = $state(-1); // index into `rows`
    let highlightedPillIndex = $state(-1); // -1 = none
    let flashKey = $state<string | null>(null);
    let inputEl = $state<HTMLInputElement | null>(null);
    let rowEls: HTMLLIElement[] = $state([]);
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    // --- mode derivation ---
    const hasList = $derived(options.length > 0);
    const mode2 = $derived(hasList && !strict); // predefined + non-strict
    const atMax = $derived(max !== undefined && value.length >= max);

    // --- option model ---
    const allOptions = $derived(coerceOptions(options));
    const selectedOptions = $derived(
        value.map(
            (v) =>
                allOptions.find((o) => o.value === v) ?? {
                    value: v,
                    label: v,
                    disabled: false,
                },
        ),
    );
    const selectedSet = $derived(new Set(value.map((v) => dupKey(v))));
    const filteredOptions = $derived(
        hasList
            ? allOptions.filter(
                  (o) =>
                      !selectedSet.has(dupKey(o.value)) &&
                      (query.trim() === "" || matcher(o, query)),
              )
            : [],
    );
    const poolExhausted = $derived(
        hasList && allOptions.every((o) => selectedSet.has(dupKey(o.value))),
    );
    const duplicateExists = (raw: string) => selectedSet.has(dupKey(raw));
    const showCreateRow = $derived(
        mode2 &&
            query.trim() !== "" &&
            !duplicateExists(query) &&
            !filteredOptions.some((o) => dupKey(o.label) === dupKey(query)),
    );

    // --- unified dropdown rows (drives keyboard nav + aria-activedescendant) ---
    type Row =
        | { kind: "option"; option: NormalizedOption; selectable: boolean }
        | { kind: "create"; text: string; selectable: true }
        | { kind: "message"; text: string; selectable: false };

    const rows = $derived.by<Row[]>(() => {
        if (!hasList) return [];
        const out: Row[] = filteredOptions.map((o) => ({
            kind: "option",
            option: o,
            selectable: !o.disabled,
        }));
        if (showCreateRow) {
            out.push({ kind: "create", text: query.trim(), selectable: true });
        }
        if (out.length === 0) {
            out.push({
                kind: "message",
                text: poolExhausted ? "Nothing left" : "Nothing found",
                selectable: false,
            });
        }
        return out;
    });

    const liveMessage = $derived.by(() => {
        if (!open || !hasList) return "";
        const msgRow = rows.find((r) => r.kind === "message");
        if (msgRow) return msgRow.kind === "message" ? msgRow.text : "";
        const n = rows.filter((r) => r.selectable).length;
        return `${n} option${n === 1 ? "" : "s"} available`;
    });

    // --- active-row index housekeeping ---
    function firstSelectable(list: Row[]): number {
        return list.findIndex((r) => r.selectable);
    }
    function nextSelectable(from: number, dir: 1 | -1): number {
        const n = rows.length;
        for (let step = 1; step <= n; step++) {
            const i = from + dir * step;
            if (i < 0 || i >= n) break;
            if (rows[i].selectable) return i;
        }
        return from >= 0 && rows[from]?.selectable
            ? from
            : firstSelectable(rows);
    }

    // Keep activeIndex pointing at a valid, selectable row as the list changes.
    $effect(() => {
        const list = rows;
        if (!open || list.length === 0) {
            if (activeIndex !== -1) activeIndex = -1;
            return;
        }
        if (
            activeIndex < 0 ||
            activeIndex >= list.length ||
            !list[activeIndex].selectable
        ) {
            activeIndex = firstSelectable(list);
        }
    });

    // Clean up the flash timer on unmount.
    $effect(() => () => clearTimeout(flashTimer));

    // --- commit / remove primitives ---
    function commitOption(o: NormalizedOption) {
        if (o.disabled || atMax || duplicateExists(o.value)) return;
        value = [...value, o.value];
        query = "";
        onchange?.(value);
        inputEl?.focus();
    }

    function commitFreeText(raw: string) {
        const key = dupKey(raw);
        if (key === "") return;
        if (duplicateExists(raw)) {
            flash(raw);
            return; // keep query so the user can edit it
        }
        // mode 2: an unselected list option matching exactly -> commit the real option
        if (mode2) {
            const exact = allOptions.find(
                (o) => dupKey(o.value) === key && !selectedSet.has(key),
            );
            if (exact) {
                commitOption(exact);
                return;
            }
        }
        if (atMax) return;
        const text = raw.trim();
        value = [...value, text];
        query = "";
        oncreate?.(text);
        onchange?.(value);
        inputEl?.focus();
    }

    function commitRow(row: Row) {
        if (row.kind === "option") commitOption(row.option);
        else if (row.kind === "create") commitFreeText(row.text);
    }

    function removeAt(i: number) {
        if (i < 0 || i >= value.length) return;
        value = [...value.slice(0, i), ...value.slice(i + 1)];
        highlightedPillIndex = -1;
        onchange?.(value);
        inputEl?.focus();
    }

    function flash(raw: string) {
        const key = dupKey(raw);
        clearTimeout(flashTimer);
        flashKey = null;
        // Re-set on the next frame so the CSS animation restarts cleanly.
        requestAnimationFrame(() => {
            flashKey = key;
            flashTimer = setTimeout(() => (flashKey = null), 350);
        });
    }

    function scrollActiveIntoView() {
        requestAnimationFrame(() =>
            rowEls[activeIndex]?.scrollIntoView({ block: "nearest" }),
        );
    }

    // --- input event handlers ---
    function escapeRe(s: string) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
        highlightedPillIndex = -1;
        let v = e.currentTarget.value;

        if ((mode2 || !hasList) && separators.length > 0) {
            const sepRe = new RegExp(`[${separators.map(escapeRe).join("")}]`);
            if (sepRe.test(v)) {
                const parts = v.split(sepRe);
                const remainder = parts.pop() ?? "";
                for (const p of parts) commitFreeText(p);
                v = remainder;
            }
        }

        query = v;
        if (hasList && !atMax) open = true;
    }

    function handleKeydown(e: KeyboardEvent) {
        const queryEmpty = query === "";

        // Cancel an active pill highlight as soon as the user types something printable.
        if (
            highlightedPillIndex >= 0 &&
            e.key.length === 1 &&
            !e.metaKey &&
            !e.ctrlKey &&
            e.key !== " "
        ) {
            highlightedPillIndex = -1;
        }

        switch (e.key) {
            case "ArrowDown":
                if (!hasList) return;
                e.preventDefault();
                if (!open) {
                    open = true;
                } else if (activeIndex >= 0) {
                    activeIndex = nextSelectable(activeIndex, 1);
                    scrollActiveIntoView();
                }
                return;
            case "ArrowUp":
                if (!hasList || !open) return;
                e.preventDefault();
                activeIndex = nextSelectable(activeIndex, -1);
                scrollActiveIntoView();
                return;
            case "Home":
                if (!hasList || !open) return;
                e.preventDefault();
                activeIndex = firstSelectable(rows);
                scrollActiveIntoView();
                return;
            case "End":
                if (!hasList || !open) return;
                e.preventDefault();
                activeIndex = nextSelectable(rows.length, -1);
                scrollActiveIntoView();
                return;
            case "Enter": {
                if (hasList && open && activeIndex >= 0 && rows[activeIndex]) {
                    e.preventDefault();
                    commitRow(rows[activeIndex]);
                    return;
                }
                // strict + list: custom text is never committed
                if (hasList && strict) {
                    e.preventDefault();
                    return;
                }
                // non-strict or freestyle: create a bespoke pill
                if (query.trim() !== "") {
                    e.preventDefault();
                    commitFreeText(query);
                }
                return;
            }
            case "Escape":
                if (open) {
                    e.preventDefault();
                    e.stopPropagation();
                    open = false;
                    activeIndex = -1;
                }
                return;
            case "Backspace":
                if (!queryEmpty || value.length === 0) return;
                e.preventDefault();
                if (highlightedPillIndex < 0) {
                    highlightedPillIndex = value.length - 1;
                } else {
                    removeAt(highlightedPillIndex);
                }
                return;
            case "ArrowLeft":
                if (!queryEmpty || value.length === 0) return;
                e.preventDefault();
                highlightedPillIndex =
                    highlightedPillIndex < 0
                        ? value.length - 1
                        : Math.max(0, highlightedPillIndex - 1);
                return;
            case "ArrowRight":
                if (highlightedPillIndex < 0) return;
                e.preventDefault();
                highlightedPillIndex =
                    highlightedPillIndex >= value.length - 1
                        ? -1
                        : highlightedPillIndex + 1;
                return;
        }
    }

    function handleFocus() {
        if (hasList && !atMax) open = true;
    }

    function handleFocusOut(e: FocusEvent) {
        const next = e.relatedTarget;
        if (next instanceof Node && ref?.contains(next)) return;
        open = false;
        highlightedPillIndex = -1;
    }

    function handlePointerDown(e: PointerEvent) {
        const target = e.target as HTMLElement;
        if (target === inputEl) return;
        if (target.closest("button")) return; // let pill remove buttons work
        e.preventDefault(); // keep focus on the input
        inputEl?.focus();
    }
</script>

<div
    bind:this={ref}
    data-slot={dataSlot}
    class={cn(comboboxVariants(), className)}
    aria-invalid={ariaInvalid}
    onpointerdown={handlePointerDown}
    onfocusout={handleFocusOut}
    {...restProps}
>
    <!-- Single-row scroll track: pills + input never wrap; overflow scrolls
         horizontally. Kept separate from the bordered container so the absolute
         dropdown below isn't clipped by overflow-x. -->
    <div
        class="scrollbar-none flex min-h-7 flex-nowrap items-stretch gap-xs overflow-x-auto"
    >
        <!-- Selected pills -->
        {#if selectedOptions.length > 0}
            <ul
                role="list"
                aria-label={`${selectedOptions.length} selected`}
                class="contents"
            >
                {#each selectedOptions as option, i (option.value)}
                    {@const remove = () => removeAt(i)}
                    {#if pill}
                        {@render pill(option, remove)}
                    {:else}
                        <li
                            data-highlighted={highlightedPillIndex === i
                                ? ""
                                : undefined}
                            data-flash={flashKey === dupKey(option.value)
                                ? "true"
                                : undefined}
                            class="inline-flex shrink-0 items-center gap-1 self-center rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground data-highlighted:bg-primary data-highlighted:text-primary-foreground data-[flash=true]:bg-destructive/15 data-[flash=true]:animate-cmb-flash"
                        >
                            <span class="max-w-[16ch] truncate"
                                >{option.label}</span
                            >
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                tabindex={-1}
                                aria-label={`Remove ${option.label}`}
                                onclick={remove}
                            >
                                <Icon fontsize={14}>close</Icon>
                            </Button>
                        </li>
                    {/if}
                {/each}
            </ul>
        {/if}

        <!-- Inline input — stretches to the full container height -->
        <input
            bind:this={inputEl}
            role="combobox"
            aria-expanded={open && hasList}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={open && activeIndex >= 0
                ? rowId(activeIndex)
                : undefined}
            aria-disabled={atMax ? true : undefined}
            {disabled}
            value={query}
            placeholder={value.length === 0 ? placeholder : inputPlaceholder}
            class="min-w-[6ch] flex-1 self-stretch border-0 bg-transparent p-0 text-sm shadow-none outline-none focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            oninput={handleInput}
            onkeydown={handleKeydown}
            onfocus={handleFocus}
        />
    </div>

    <!-- Dropdown -->
    {#if open && hasList}
        <!-- Anchored to the bottom edge; viewport-collision flip is deferred
             (would require manual rect measurement — no Floating UI available). -->
        <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            class="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface-container-low py-1 shadow-md"
        >
            {#each rows as row, i (row.kind + i + (row.kind !== "message" ? (row.kind === "option" ? row.option.value : row.text) : ""))}
                <!-- Keyboard handling lives on the combobox input via
                     aria-activedescendant; options are not separately focusable. -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <li
                    bind:this={rowEls[i]}
                    id={rowId(i)}
                    role="option"
                    aria-selected={false}
                    aria-disabled={!row.selectable ? true : undefined}
                    data-active={activeIndex === i ? "" : undefined}
                    class={cn(
                        "flex items-center px-2.5 py-1.5 text-sm",
                        row.selectable
                            ? "cursor-pointer data-active:bg-primary"
                            : "text-muted-foreground",
                    )}
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => commitRow(row)}
                >
                    {#if row.kind === "option"}
                        {#if optionItem}
                            {@render optionItem(row.option, activeIndex === i)}
                        {:else}
                            <span
                                class="truncate"
                                class:opacity-50={row.option.disabled}
                                >{row.option.label}</span
                            >
                        {/if}
                    {:else if row.kind === "create"}
                        <Icon fontsize={16} class="mr-1.5 text-muted-foreground"
                            >add</Icon
                        >
                        <span class="truncate">Create "{row.text}"</span>
                    {:else if row.text === "Nothing left" && exhausted}
                        {@render exhausted()}
                    {:else if row.text === "Nothing found" && empty}
                        {@render empty()}
                    {:else}
                        {row.text}
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}

    <!-- Screen-reader announcements -->
    <span id={liveId} aria-live="polite" class="sr-only">{liveMessage}</span>
</div>
