<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import type { Snippet } from "svelte";
    import {
        type SelectOption,
        type NormalizedSelectOption,
    } from "./select.js";

    export type SelectProps = WithElementRef<
        Omit<HTMLAttributes<HTMLButtonElement>, "onchange" | "value">,
        HTMLButtonElement
    > & {
        /** Bindable selected value */
        value?: string;
        /** List of options */
        options?: SelectOption[];
        /** Placeholder text when nothing is selected */
        placeholder?: string;
        /** Disable the dropdown */
        disabled?: boolean;
        /** Screen reader validation state */
        "aria-invalid"?: boolean | "true" | "false" | null;
        /** Callback when value changes */
        onchange?: (value: string) => void;
        /** Show a search field inside the dropdown that filters options as you type */
        searchable?: boolean;
        /** Placeholder for the search field (only used when `searchable`) */
        searchPlaceholder?: string;
        /** Custom snippet for trigger display label */
        triggerContent?: Snippet<[NormalizedSelectOption]>;
        /** Custom snippet for rendering list options */
        optionItem?: Snippet<
            [NormalizedSelectOption, { active: boolean; selected: boolean }]
        >;
    };

    export {
        type SelectOption,
        type NormalizedSelectOption,
        type SelectSection,
    } from "./select.js";
</script>

<script lang="ts">
    import { coerceOptions, filterOptions, groupOptions } from "./select.js";
    import { shouldCloseOnFocusOut } from "../combobox/combobox.js";
    import { Icon } from "$lib/components/icon/index.js";

    let {
        ref = $bindable(null),
        class: className,
        value = $bindable(),
        options = [],
        placeholder = "Select an option...",
        disabled = false,
        "aria-invalid": ariaInvalid = null,
        "data-slot": dataSlot = "select",
        searchable = false,
        searchPlaceholder = "Search...",
        onchange,
        triggerContent,
        optionItem,
        ...restProps
    }: SelectProps = $props();

    // --- ARIA unique ids ---
    const uid = $props.id();
    const listboxId = `${uid}-listbox`;
    const itemId = (i: number) => `${uid}-item-${i}`;

    // --- state ---
    let open = $state(false);
    let activeIndex = $state(-1);
    let optionEls: HTMLLIElement[] = $state([]);
    let containerEl = $state<HTMLDivElement | null>(null);
    let query = $state("");
    let searchEl = $state<HTMLInputElement | null>(null);
    // Pointer is down on the listbox. Not reactive — only event handlers read it.
    let listPointer = false;

    function handleWindowClick(e: MouseEvent) {
        if (!open) return;
        const target = e.target as HTMLElement;
        if (containerEl && !containerEl.contains(target)) {
            open = false;
        }
    }

    // --- derived option model ---
    const allOptions = $derived(coerceOptions(options));
    // The visible list is what keyboard nav, ids, and activeIndex all address, so a
    // filtered-out option can never be reached by an arrow key or committed by Enter.
    const visibleOptions = $derived(
        searchable ? filterOptions(allOptions, query) : allOptions,
    );
    const sections = $derived(groupOptions(visibleOptions));
    // Resolved against every option, not just the visible ones: the trigger must keep
    // showing the current selection while a query filters it out of the list.
    const selectedOption = $derived(allOptions.find((o) => o.value === value));
    const selectedIndex = $derived(
        visibleOptions.findIndex((o) => o.value === value),
    );

    // Closing resets the query so the next open starts from the full list. Kept apart
    // from the sync effect below, which reads the query it would otherwise write.
    $effect(() => {
        if (!open) {
            activeIndex = -1;
            query = "";
        }
    });

    // Keep activeIndex synced when the dropdown opens, and re-anchor it whenever the
    // query narrows the list — an index into the old list would point at the wrong row.
    $effect(() => {
        if (open) {
            activeIndex =
                selectedIndex !== -1 ? selectedIndex : firstSelectable();
        }
    });

    // The search field is the point of opening a searchable dropdown; focus it so the
    // user can type immediately rather than having to click into it.
    $effect(() => {
        if (open && searchable) searchEl?.focus();
    });

    // Automatically scroll highlighted option into view
    $effect(() => {
        if (open && activeIndex >= 0 && optionEls[activeIndex]) {
            optionEls[activeIndex].scrollIntoView({ block: "nearest" });
        }
    });

    function firstSelectable(): number {
        return visibleOptions.findIndex((o) => !o.disabled);
    }

    function nextSelectable(current: number, dir: 1 | -1): number {
        const n = visibleOptions.length;
        if (n === 0) return -1;

        let start = current === -1 ? (dir === 1 ? -1 : n) : current;
        let i = (start + dir + n) % n;

        // Loop at most once around the list to find a selectable option
        for (let step = 0; step < n; step++) {
            if (!visibleOptions[i].disabled) return i;
            i = (i + dir + n) % n;
        }

        return current;
    }

    function commitOption(option: NormalizedSelectOption) {
        if (option.disabled) return;
        value = option.value;
        open = false;
        onchange?.(option.value);
        ref?.focus();
    }

    function toggleOpen() {
        if (disabled) return;
        open = !open;
    }

    function commitActive() {
        if (activeIndex >= 0 && activeIndex < visibleOptions.length) {
            commitOption(visibleOptions[activeIndex]);
        }
    }

    /** Navigation shared by the trigger and the search field. */
    function handleNavKeydown(e: KeyboardEvent): boolean {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                if (!open) open = true;
                else activeIndex = nextSelectable(activeIndex, 1);
                return true;
            case "ArrowUp":
                e.preventDefault();
                if (!open) open = true;
                else activeIndex = nextSelectable(activeIndex, -1);
                return true;
            case "Enter":
                e.preventDefault();
                if (!open) open = true;
                else commitActive();
                return true;
            case "Escape":
                e.preventDefault();
                if (open) {
                    open = false;
                    ref?.focus();
                }
                return true;
            case "Tab":
                open = false;
                return true;
        }
        return false;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (disabled) return;
        if (handleNavKeydown(e)) return;
        // Space toggles/commits from the trigger only. In the search field it is an
        // ordinary character, and swallowing it would make multi-word queries impossible.
        if (e.key === " ") {
            e.preventDefault();
            if (!open) open = true;
            else commitActive();
        }
    }

    function handleSearchKeydown(e: KeyboardEvent) {
        if (disabled) return;
        handleNavKeydown(e);
    }

    function handleFocusOut(e: FocusEvent) {
        if (!shouldCloseOnFocusOut(e.relatedTarget, containerEl, listPointer)) {
            return;
        }
        open = false;
    }

    function beginListPointer() {
        listPointer = true;
    }

    function endListPointer() {
        // pointerup runs before click (and sometimes before a delayed blur).
        // Drop the flag on the next frame so the in-flight tap can still commit.
        requestAnimationFrame(() => {
            listPointer = false;
        });
    }
</script>

<svelte:window
    onclick={handleWindowClick}
    onpointerup={endListPointer}
    onpointercancel={endListPointer}
/>

<!-- Outer container that captures focusout to close the dropdown -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={containerEl}
    class={cn("relative w-full min-w-0", className)}
    onfocusout={handleFocusOut}
>
    <button
        bind:this={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0
            ? itemId(activeIndex)
            : undefined}
        aria-invalid={ariaInvalid}
        {disabled}
        data-slot={dataSlot}
        class="dark:bg-input/30 border-input focus:border-ring focus:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-9 rounded-md border bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] focus:ring-3 aria-expanded:border-ring aria-expanded:ring-3 aria-expanded:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 outline-none flex items-center justify-between cursor-pointer w-full text-left select-none"
        onkeydown={handleKeydown}
        onclick={toggleOpen}
        {...restProps}
    >
        {#if selectedOption}
            {#if triggerContent}
                {@render triggerContent(selectedOption)}
            {:else}
                <span class="truncate pr-4">{selectedOption.label}</span>
            {/if}
        {:else}
            <span class="text-muted-foreground truncate pr-4"
                >{placeholder}</span
            >
        {/if}

        <Icon
            fontsize={20}
            class={cn(
                "transition-transform duration-200 text-muted-foreground origin-center shrink-0",
                open && "rotate-180",
            )}
        >
            keyboard_arrow_down
        </Icon>
    </button>

    {#if open && (allOptions.length > 0 || searchable)}
        <div
            data-slot="select-popover"
            class="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface-container-low shadow-md"
        >
            {#if searchable}
                <div class="border-b border-border/50 p-1">
                    <input
                        bind:this={searchEl}
                        bind:value={query}
                        type="text"
                        role="searchbox"
                        autocomplete="off"
                        spellcheck="false"
                        aria-label={searchPlaceholder}
                        aria-controls={listboxId}
                        aria-activedescendant={activeIndex >= 0
                            ? itemId(activeIndex)
                            : undefined}
                        placeholder={searchPlaceholder}
                        class="w-full rounded-sm bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                        onkeydown={handleSearchKeydown}
                    />
                </div>
            {/if}

            <ul
                id={listboxId}
                role="listbox"
                tabindex={-1}
                class="max-h-60 overflow-y-auto py-1 outline-none touch-manipulation"
                onpointerdown={beginListPointer}
            >
                {#each sections as section (section.label ?? "")}
                    {#if section.label}
                        <li
                            role="presentation"
                            class="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                        >
                            {section.label}
                        </li>
                    {/if}
                    {#each section.options as { option, index } (option.value)}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <li
                            bind:this={optionEls[index]}
                            id={itemId(index)}
                            role="option"
                            aria-selected={value === option.value}
                            aria-disabled={option.disabled ? true : undefined}
                            data-active={activeIndex === index ? "" : undefined}
                            data-selected={value === option.value
                                ? ""
                                : undefined}
                            class={cn(
                                "flex items-center justify-between px-2.5 py-1.5 text-sm transition-colors",
                                option.disabled
                                    ? "text-muted-foreground opacity-50 cursor-not-allowed"
                                    : "cursor-pointer hover:bg-muted/50 data-active:bg-primary data-active:text-primary-foreground data-selected:bg-primary/20 dark:data-selected:bg-primary/30",
                            )}
                            onpointerdown={(e) => {
                                // Mouse: keep the trigger/search focused so
                                // focusout doesn't close the list. Touch: must
                                // not preventDefault — that suppresses click.
                                if (e.pointerType === "mouse") {
                                    e.preventDefault();
                                }
                            }}
                            onmousedown={(e) => {
                                if (typeof PointerEvent === "undefined") {
                                    e.preventDefault();
                                }
                            }}
                            onclick={() =>
                                !option.disabled && commitOption(option)}
                        >
                            {#if optionItem}
                                {@render optionItem(option, {
                                    active: activeIndex === index,
                                    selected: value === option.value,
                                })}
                            {:else}
                                <span
                                    class="truncate"
                                    class:font-semibold={value === option.value}
                                    >{option.label}</span
                                >
                                {#if value === option.value}
                                    <Icon
                                        class="h-4 w-4 text-primary-foreground"
                                        name="check"
                                    />
                                {/if}
                            {/if}
                        </li>
                    {/each}
                {/each}

                {#if visibleOptions.length === 0}
                    <li
                        role="presentation"
                        class="px-2.5 py-3 text-center text-sm text-muted-foreground"
                    >
                        No matches
                    </li>
                {/if}
            </ul>
        </div>
    {/if}
</div>
