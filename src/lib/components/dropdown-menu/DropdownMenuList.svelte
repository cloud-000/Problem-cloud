<script lang="ts">
    import { onMount } from "svelte";
    import { Icon } from "$lib/components/icon/index.js";
    import { cn } from "$lib/utils.js";
    import type { DropdownOption } from "./dropdown-menu.js";
    import DropdownMenuList from "./DropdownMenuList.svelte";

    interface Props {
        options: DropdownOption[];
        parentEl: HTMLElement | null;
        isRoot: boolean;
        activePath: number[];
        depth: number;
        pathPrefix: number[];
        onSelect: (option: DropdownOption, event: MouseEvent | KeyboardEvent) => void;
        onHover: (path: number[]) => void;
        onClose: () => void;
    }

    let {
        options,
        parentEl,
        isRoot,
        activePath,
        depth,
        pathPrefix,
        onSelect,
        onHover,
        onClose,
    }: Props = $props();

    let menuEl = $state<HTMLUListElement | null>(null);
    let itemEls = $state<HTMLLIElement[]>([]);
    let coords = $state({ top: 0, left: 0, visibility: "hidden" as "hidden" | "visible" });

    // Function to calculate position ensuring the dropdown menu stays within window bounds
    function calculatePosition() {
        if (!menuEl || !parentEl) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const parentRect = parentEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();

        const gap = 4;
        let top = 0;
        let left = 0;

        if (isRoot) {
            // Root menu renders below the trigger by default
            top = parentRect.bottom + gap;
            left = parentRect.left;

            // Flip above trigger if overflowing bottom
            if (top + menuRect.height > viewportHeight) {
                top = parentRect.top - gap - menuRect.height;
            }

            // Align to right edge of trigger if overflowing right
            if (left + menuRect.width > viewportWidth) {
                left = parentRect.right - menuRect.width;
            }
        } else {
            // Submenu renders to the right of parent list item by default
            top = parentRect.top;
            left = parentRect.right + gap;

            // Flip to the left of parent item if overflowing right
            if (left + menuRect.width > viewportWidth) {
                left = parentRect.left - gap - menuRect.width;
            }

            // Shift up if overflowing bottom
            if (top + menuRect.height > viewportHeight) {
                top = viewportHeight - menuRect.height - gap;
            }
        }

        // Prevent rendering outside screen borders (with safety padding)
        left = Math.max(gap, Math.min(left, viewportWidth - menuRect.width - gap));
        top = Math.max(gap, Math.min(top, viewportHeight - menuRect.height - gap));

        coords = {
            top,
            left,
            visibility: "visible",
        };
    }

    // Recalculate position on changes and mount
    $effect(() => {
        if (menuEl && parentEl) {
            calculatePosition();
        }
    });

    let hoverTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

    function handleMouseEnter(i: number) {
        const option = options[i];
        if (option.disabled || option.type === "divider" || option.type === "header") return;

        // Clear all pending timeouts
        for (const [key, timeout] of hoverTimeouts.entries()) {
            clearTimeout(timeout);
            hoverTimeouts.delete(key);
        }

        const timeout = setTimeout(() => {
            onHover([...pathPrefix, i]);
        }, 80); // Quick debounce for smooth transitions

        hoverTimeouts.set(i, timeout);
    }

    function handleMouseLeave(i: number) {
        const timeout = hoverTimeouts.get(i);
        if (timeout) {
            clearTimeout(timeout);
            hoverTimeouts.delete(i);
        }
    }

    // Check if a tailwind color class is passed (vs standard hex/rgb color)
    function getTextColorClass(color: string | undefined): string {
        if (!color) return "text-foreground hover:bg-muted dark:hover:bg-muted/50 data-[active=true]:bg-muted dark:data-[active=true]:bg-muted/50";
        if (color.startsWith("text-") || color.startsWith("bg-") || (!color.includes("#") && !color.includes("rgb") && !color.includes("hsl") && !color.includes("("))) {
            return color;
        }
        return "";
    }

    function getCustomStyle(color: string | undefined): string | undefined {
        if (!color) return undefined;
        // If not a tailwind class, treat as raw CSS color
        if (color.startsWith("text-") || color.startsWith("bg-") || (!color.includes("#") && !color.includes("rgb") && !color.includes("hsl") && !color.includes("("))) {
            return undefined;
        }
        return `color: ${color}`;
    }

    function isItemActive(i: number): boolean {
        return activePath.length > depth && activePath[depth] === i;
    }

    function isSubmenuOpen(i: number): boolean {
        return isItemActive(i) && !!options[i].submenu?.length;
    }

    // Action to portal the element to document.body to escape topbar stacking context
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            }
        };
    }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<ul
    use:portal
    bind:this={menuEl}
    role="menu"
    tabindex="-1"
    class="fixed z-50 min-w-[200px] rounded-lg border border-border bg-surface-container-lowest p-1 shadow-lg outline-none flex flex-col gap-0.5 select-none"
    style="top: {coords.top}px; left: {coords.left}px; visibility: {coords.visibility}; max-height: 85vh; overflow-y: auto;"
>
    {#each options as option, i}
        {#if option.type === "divider"}
            <li class="h-[1px] bg-border my-1" role="separator"></li>
        {:else if option.type === "header"}
            <li class="px-2.5 py-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase select-none">
                {option.label}
            </li>
        {:else}
            <!-- svelte-ignore a11y_mouse_events_have_key_events -->
            <li
                bind:this={itemEls[i]}
                role="none"
                class="relative"
                onmouseenter={() => handleMouseEnter(i)}
                onmouseleave={() => handleMouseLeave(i)}
            >
                <button
                    type="button"
                    role="menuitem"
                    aria-haspopup={option.submenu?.length ? "true" : undefined}
                    aria-expanded={isSubmenuOpen(i) ? "true" : undefined}
                    disabled={option.disabled}
                    data-active={isItemActive(i) ? "true" : undefined}
                    class={cn(
                        "w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-md text-left transition-colors cursor-pointer outline-none select-none disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none group",
                        getTextColorClass(option.color),
                        // Add generic styling for items with custom style colors to ensure correct hover backgrounds
                        option.color && !getTextColorClass(option.color) && "hover:bg-muted dark:hover:bg-muted/50 data-[active=true]:bg-muted dark:data-[active=true]:bg-muted/50"
                    )}
                    style={getCustomStyle(option.color)}
                    onclick={(e) => {
                        e.stopPropagation();
                        if (option.submenu?.length) {
                            // Toggle or open submenu on click
                            onHover([...pathPrefix, i]);
                        } else {
                            onSelect(option, e);
                        }
                    }}
                >
                    {#if option.icon}
                        <Icon
                            name={option.icon}
                            fill={option.iconFill}
                            fontsize={18}
                            class={cn(
                                "text-muted-foreground shrink-0 transition-colors",
                                isItemActive(i) ? "text-current" : "group-hover:text-foreground"
                            )}
                        />
                    {/if}
                    <span class="flex-1 truncate">{option.label}</span>
                    
                    {#if option.submenu?.length}
                        <Icon
                            name="chevron_right"
                            fontsize={16}
                            class="text-muted-foreground/60 shrink-0 ml-auto"
                        />
                    {/if}
                </button>

                {#if isSubmenuOpen(i) && option.submenu}
                    <DropdownMenuList
                        options={option.submenu}
                        parentEl={itemEls[i]}
                        isRoot={false}
                        {activePath}
                        depth={depth + 1}
                        pathPrefix={[...pathPrefix, i]}
                        {onSelect}
                        {onHover}
                        {onClose}
                    />
                {/if}
            </li>
        {/if}
    {/each}
</ul>
