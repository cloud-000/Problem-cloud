<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { setContext, getContext } from "svelte";

    export const SIDEBAR_CONTEXT_KEY = Symbol("sidebar");

    export interface SidebarContext {
        expanded: boolean;
        collapsible: "icon" | "none";
    }

    export function useSidebar() {
        const context = getContext<SidebarContext | undefined>(SIDEBAR_CONTEXT_KEY);
        if (!context) {
            throw new Error("Sidebar child components must be used within a <Sidebar.Root>");
        }
        return context;
    }

    export type SidebarProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        expanded?: boolean;
        collapsible?: "icon" | "none";
    };
</script>

<script lang="ts">
    let {
        ref = $bindable(null),
        class: className,
        expanded = $bindable(true),
        collapsible = "icon",
        children,
        ...restProps
    }: SidebarProps = $props();

    // Establish context with getters and setters to bind back to the props
    setContext<SidebarContext>(SIDEBAR_CONTEXT_KEY, {
        get expanded() {
            return expanded;
        },
        set expanded(val: boolean) {
            expanded = val;
        },
        get collapsible() {
            return collapsible;
        }
    });
</script>

<div
    bind:this={ref}
    data-slot="sidebar-root"
    data-expanded={expanded}
    data-collapsible={collapsible}
    class={cn(
        "flex flex-col h-full border-r border-border bg-surface-container-low transition-all duration-300 ease-in-out select-none shrink-0",
        expanded ? "w-64" : collapsible === "icon" ? "w-16" : "w-0 overflow-hidden border-r-0",
        className
    )}
    {...restProps}
>
    {@render children?.()}
</div>
