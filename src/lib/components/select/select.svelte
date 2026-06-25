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
        /** Custom snippet for trigger display label */
        triggerContent?: Snippet<[NormalizedSelectOption]>;
        /** Custom snippet for rendering list options */
        optionItem?: Snippet<[NormalizedSelectOption, { active: boolean; selected: boolean }]>;
    };

    export {
        type SelectOption,
        type NormalizedSelectOption,
    } from "./select.js";
</script>

<script lang="ts">
    import { coerceOptions } from "./select.js";
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

    function handleWindowClick(e: MouseEvent) {
        if (!open) return;
        const target = e.target as HTMLElement;
        if (containerEl && !containerEl.contains(target)) {
            open = false;
        }
    }

    // --- derived option model ---
    const allOptions = $derived(coerceOptions(options));
    const selectedOption = $derived(allOptions.find((o) => o.value === value));
    const selectedIndex = $derived(allOptions.findIndex((o) => o.value === value));

    // Keep activeIndex synced when dropdown opens
    $effect(() => {
        if (open) {
            activeIndex = selectedIndex !== -1 ? selectedIndex : firstSelectable();
        } else {
            activeIndex = -1;
        }
    });

    // Automatically scroll highlighted option into view
    $effect(() => {
        if (open && activeIndex >= 0 && optionEls[activeIndex]) {
            optionEls[activeIndex].scrollIntoView({ block: "nearest" });
        }
    });

    function firstSelectable(): number {
        return allOptions.findIndex((o) => !o.disabled);
    }

    function nextSelectable(current: number, dir: 1 | -1): number {
        const n = allOptions.length;
        if (n === 0) return -1;
        
        let start = current === -1 ? (dir === 1 ? -1 : n) : current;
        let i = (start + dir + n) % n;
        
        // Loop at most once around the list to find a selectable option
        for (let step = 0; step < n; step++) {
            if (!allOptions[i].disabled) return i;
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

    function handleKeydown(e: KeyboardEvent) {
        if (disabled) return;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                if (!open) {
                    open = true;
                } else {
                    activeIndex = nextSelectable(activeIndex, 1);
                }
                break;
            case "ArrowUp":
                e.preventDefault();
                if (!open) {
                    open = true;
                } else {
                    activeIndex = nextSelectable(activeIndex, -1);
                }
                break;
            case "Enter":
            case " ": // Space
                e.preventDefault();
                if (!open) {
                    open = true;
                } else {
                    if (activeIndex >= 0 && activeIndex < allOptions.length) {
                        commitOption(allOptions[activeIndex]);
                    }
                }
                break;
            case "Escape":
                e.preventDefault();
                if (open) {
                    open = false;
                    ref?.focus();
                }
                break;
            case "Tab":
                open = false;
                break;
        }
    }

    function handleFocusOut(e: FocusEvent) {
        const next = e.relatedTarget;
        // If focus moves to something outside our dropdown wrapper, close the dropdown
        if (next instanceof Node && containerEl && containerEl.contains(next)) {
            return;
        }
        open = false;
    }
</script>

<svelte:window onclick={handleWindowClick} />

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
        aria-activedescendant={open && activeIndex >= 0 ? itemId(activeIndex) : undefined}
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
            <span class="text-muted-foreground truncate pr-4">{placeholder}</span>
        {/if}

        <Icon
            fontsize={20}
            class={cn(
                "transition-transform duration-200 text-muted-foreground origin-center shrink-0",
                open && "rotate-180"
            )}
        >
            keyboard_arrow_down
        </Icon>
    </button>

    {#if open && allOptions.length > 0}
        <ul
            id={listboxId}
            role="listbox"
            tabindex={-1}
            class="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-surface-container-low py-1 shadow-md outline-none"
        >
            {#each allOptions as option, i (option.value)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <li
                    bind:this={optionEls[i]}
                    id={itemId(i)}
                    role="option"
                    aria-selected={value === option.value}
                    aria-disabled={option.disabled ? true : undefined}
                    data-active={activeIndex === i ? "" : undefined}
                    data-selected={value === option.value ? "" : undefined}
                    class={cn(
                        "flex items-center justify-between px-2.5 py-1.5 text-sm transition-colors",
                        option.disabled
                            ? "text-muted-foreground opacity-50 cursor-not-allowed"
                            : "cursor-pointer hover:bg-muted/50 data-active:bg-primary data-active:text-primary-foreground data-selected:bg-primary/20 dark:data-selected:bg-primary/30"
                    )}
                    onmousedown={(e) => e.preventDefault()}
                    onclick={() => !option.disabled && commitOption(option)}
                >
                    {#if optionItem}
                        {@render optionItem(option, { active: activeIndex === i, selected: value === option.value })}
                    {:else}
                        <span class="truncate" class:font-semibold={value === option.value}>{option.label}</span>
                        {#if value === option.value}
                            <Icon class="h-4 w-4 text-primary-foreground" name="check" />
                        {/if}
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>
