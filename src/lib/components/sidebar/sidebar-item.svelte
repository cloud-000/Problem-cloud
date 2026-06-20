<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type {
        HTMLAnchorAttributes,
        HTMLButtonAttributes,
    } from "svelte/elements";
    import { tv } from "tailwind-variants";
    import type { Snippet } from "svelte";

    export const sidebarItemVariants = tv({
        base: "group/sidebar-item relative flex items-center w-full rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 outline-none select-none text-muted-foreground cursor-pointer focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 gap-3",
        variants: {
            expanded: {
                true: "justify-start",
                false: "justify-center px-0 w-10 h-10",
            }
        },
        defaultVariants: {
            expanded: true,
        }
    });

    export type SidebarItemProps = WithElementRef<HTMLAnchorAttributes> &
        WithElementRef<HTMLButtonAttributes> & {
            href?: string;
            active?: boolean;
            activeClass?: string;
            hoverClass?: string;
            icon?: string;
            label?: string;
            tooltip?: string;
            child?: Snippet<[{ props: Record<string, any> }]>;
            children?: Snippet;
        };
</script>

<script lang="ts">
    import { useSidebar } from "./sidebar.svelte";
    import { Icon } from "$lib/components/icon/.";

    let {
        ref = $bindable(null),
        class: className,
        href,
        active = false,
        activeClass = "bg-surface-container-high text-primary font-semibold sidebar-item-active before:absolute before:left-0 before:top-1/4 before:h-1/2 before:w-[3px] before:rounded-r-full before:bg-primary",
        hoverClass = "hover:bg-surface-container hover:text-foreground",
        icon,
        label,
        tooltip,
        child,
        children,
        ...restProps
    }: SidebarItemProps = $props();

    const sidebar = useSidebar();

    // Tooltip fallback
    let computedTitle = $derived(!sidebar.expanded ? (tooltip || label) : undefined);

    // Merge styles (applies activeClass when active, and hoverClass when inactive)
    let mergedClass = $derived.by(() => {
        const baseClasses = sidebarItemVariants({ expanded: sidebar.expanded });
        return cn(
            baseClasses,
            active ? activeClass : hoverClass,
            className
        );
    });
</script>

{#if child}
    {@render child({
        props: {
            class: mergedClass,
            title: computedTitle,
            "data-slot": "sidebar-item",
            "data-active": active,
            "data-expanded": sidebar.expanded,
            ...restProps
        }
    })}
{:else}
    {#if href}
        <a
            bind:this={ref}
            data-slot="sidebar-item"
            data-active={active}
            data-expanded={sidebar.expanded}
            class={mergedClass}
            {href}
            title={computedTitle}
            {...restProps}
        >
            {#if icon}
                <Icon class={cn("shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover/sidebar-item:text-foreground")}>
                    {icon}
                </Icon>
            {/if}
            {#if sidebar.expanded}
                <span class="truncate transition-opacity duration-200">{label || ""}</span>
                {@render children?.()}
            {/if}
        </a>
    {:else}
        <button
            bind:this={ref}
            data-slot="sidebar-item"
            data-active={active}
            data-expanded={sidebar.expanded}
            type="button"
            class={mergedClass}
            title={computedTitle}
            {...restProps}
        >
            {#if icon}
                <Icon class={cn("shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover/sidebar-item:text-foreground")}>
                    {icon}
                </Icon>
            {/if}
            {#if sidebar.expanded}
                <span class="truncate transition-opacity duration-200">{label || ""}</span>
                {@render children?.()}
            {/if}
        </button>
    {/if}
{/if}

