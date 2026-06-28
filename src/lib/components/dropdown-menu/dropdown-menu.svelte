<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { Snippet } from "svelte";
    import type { DropdownOption } from "./dropdown-menu.js";
    import DropdownMenuList from "./DropdownMenuList.svelte";

    interface Props {
        /** Options list definition */
        options: DropdownOption[];
        /** Class applied to the outer relative positioning wrapper */
        class?: string;
        /** Class applied to the trigger element wrapper */
        triggerClass?: string;
        /** The trigger element(s) */
        children?: Snippet;
    }

    let {
        options,
        class: className = "",
        triggerClass = "",
        children,
    }: Props = $props();

    let open = $state(false);
    let activePath = $state<number[]>([]); // Tracks highlighted item path: [rootIndex, subIndex, subSubIndex, ...]

    let containerEl = $state<HTMLDivElement | null>(null);
    let triggerEl = $state<HTMLDivElement | null>(null);

    // Close the dropdown when clicking outside
    function handleWindowClick(e: MouseEvent) {
        if (!open) return;
        const target = e.target as HTMLElement;
        if (containerEl && !containerEl.contains(target)) {
            open = false;
        }
    }

    // Close the dropdown when scrolling or resizing to prevent menu floating
    function handleWindowScroll() {
        if (open) open = false;
    }

    function handleWindowResize() {
        if (open) open = false;
    }

    // Reset active path when closing
    $effect(() => {
        if (!open) {
            activePath = [];
        }
    });

    // Helper functions for keyboard navigation
    function firstSelectable(list: DropdownOption[]): number {
        return list.findIndex((o) => o.type !== "divider" && o.type !== "header" && !o.disabled);
    }

    function nextSelectable(list: DropdownOption[], current: number, dir: 1 | -1): number {
        const n = list.length;
        if (n === 0) return -1;
        
        let start = current === -1 ? (dir === 1 ? -1 : n) : current;
        let i = (start + dir + n) % n;
        
        for (let step = 0; step < n; step++) {
            const option = list[i];
            if (option.type !== "divider" && option.type !== "header" && !option.disabled) {
                return i;
            }
            i = (i + dir + n) % n;
        }
        return current;
    }

    // Resolves options at current active path depth
    function getOptionsAtActivePath(): { list: DropdownOption[]; pathPrefix: number[] } {
        let currentList = options;
        let pathPrefix: number[] = [];
        
        for (let depth = 0; depth < activePath.length - 1; depth++) {
            const index = activePath[depth];
            const option = currentList[index];
            if (option && option.submenu) {
                currentList = option.submenu;
                pathPrefix.push(index);
            } else {
                break;
            }
        }
        return { list: currentList, pathPrefix };
    }

    function toggleOpen() {
        open = !open;
        if (open) {
            // Find first selectable item
            const firstSel = firstSelectable(options);
            if (firstSel !== -1) {
                activePath = [firstSel];
            }
        }
    }

    function handleSelect(option: DropdownOption, event: MouseEvent | KeyboardEvent) {
        if (option.disabled || option.type === "divider" || option.type === "header") return;
        option.onclick?.(option as any); // Pass option to click handler
        open = false;
        
        // Return focus to the trigger element if focusable
        const focusable = triggerEl?.querySelector("button, a, [tabindex]") as HTMLElement | null;
        if (focusable) {
            focusable.focus();
        } else {
            triggerEl?.focus();
        }
    }

    function handleHover(path: number[]) {
        activePath = path;
    }

    // Keyboard accessibility for WCAG standards
    function handleKeydown(e: KeyboardEvent) {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                if (!open) {
                    toggleOpen();
                } else {
                    const { list, pathPrefix } = getOptionsAtActivePath();
                    const currentActive = activePath[activePath.length - 1];
                    const nextActive = nextSelectable(list, currentActive, 1);
                    if (nextActive !== -1) {
                        activePath = [...pathPrefix, nextActive];
                    }
                }
                break;

            case "ArrowUp":
                e.preventDefault();
                if (!open) {
                    open = true;
                    const lastSelectable = nextSelectable(options, options.length, -1);
                    activePath = [lastSelectable];
                } else {
                    const { list, pathPrefix } = getOptionsAtActivePath();
                    const currentActive = activePath[activePath.length - 1];
                    const prevActive = nextSelectable(list, currentActive, -1);
                    if (prevActive !== -1) {
                        activePath = [...pathPrefix, prevActive];
                    }
                }
                break;

            case "ArrowRight":
                if (open && activePath.length > 0) {
                    const { list } = getOptionsAtActivePath();
                    const currentActive = activePath[activePath.length - 1];
                    const activeOption = list[currentActive];
                    if (activeOption && activeOption.submenu?.length) {
                        e.preventDefault();
                        const firstSel = firstSelectable(activeOption.submenu);
                        if (firstSel !== -1) {
                            activePath = [...activePath, firstSel];
                        }
                    }
                }
                break;

            case "ArrowLeft":
                if (open && activePath.length > 1) {
                    e.preventDefault();
                    activePath = activePath.slice(0, -1);
                }
                break;

            case "Enter":
            case " ": // Space bar
                if (!open) {
                    e.preventDefault();
                    toggleOpen();
                } else if (activePath.length > 0) {
                    const { list } = getOptionsAtActivePath();
                    const currentActive = activePath[activePath.length - 1];
                    const activeOption = list[currentActive];
                    if (activeOption) {
                        e.preventDefault();
                        if (activeOption.submenu?.length) {
                            // Expand submenu on Enter/Space
                            const firstSel = firstSelectable(activeOption.submenu);
                            if (firstSel !== -1) {
                                activePath = [...activePath, firstSel];
                            }
                        } else {
                            handleSelect(activeOption, e);
                        }
                    }
                }
                break;

            case "Escape":
                if (open) {
                    e.preventDefault();
                    e.stopPropagation();
                    open = false;
                    const focusable = triggerEl?.querySelector("button, a, [tabindex]") as HTMLElement | null;
                    if (focusable) focusable.focus();
                }
                break;

            case "Tab":
                // Pressing Tab closes the menu and lets focus leave naturally
                if (open) {
                    open = false;
                }
                break;
        }
    }
</script>

<svelte:window
    onclick={handleWindowClick}
    onscroll={handleWindowScroll}
    onresize={handleWindowResize}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={containerEl}
    class={cn("relative inline-block", className)}
    onkeydown={handleKeydown}
>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        bind:this={triggerEl}
        class={cn("inline-flex cursor-pointer select-none", triggerClass)}
        onclick={toggleOpen}
    >
        {@render children?.()}
    </div>

    {#if open}
        <DropdownMenuList
            options={options}
            parentEl={triggerEl}
            isRoot={true}
            {activePath}
            depth={0}
            pathPrefix={[]}
            onSelect={handleSelect}
            onHover={handleHover}
            onClose={() => open = false}
        />
    {/if}
</div>
