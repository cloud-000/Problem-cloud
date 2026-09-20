<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { setContext, getContext } from "svelte";
    import {
        DEFAULT_SIDEBAR_WIDTH,
        MIN_SIDEBAR_WIDTH,
        MAX_SIDEBAR_WIDTH,
        SIDEBAR_WIDTH_STORAGE_KEY,
    } from "$lib/sidebar-persistence";

    export const SIDEBAR_CONTEXT_KEY = Symbol("sidebar");

    export interface SidebarContext {
        expanded: boolean;
        collapsible: "icon" | "none";
        width?: number;
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
        resizable?: boolean;
        initialWidth?: number;
        minWidth?: number;
        maxWidth?: number;
        storageKey?: string;
        collapseThresholdRatio?: number;
        onWidthChange?: (width: number) => void;
        onResizeEnd?: (width: number) => void;
    };
</script>

<script lang="ts">
    import { ResizablePanel, type PanelSize } from "$lib/components/resizable-panel";

    let {
        ref = $bindable(null),
        class: className,
        expanded = $bindable(true),
        collapsible = "icon",
        resizable = true,
        initialWidth = DEFAULT_SIDEBAR_WIDTH,
        minWidth = MIN_SIDEBAR_WIDTH,
        maxWidth = MAX_SIDEBAR_WIDTH,
        storageKey = SIDEBAR_WIDTH_STORAGE_KEY,
        collapseThresholdRatio = 0.7,
        onWidthChange,
        onResizeEnd,
        children,
        ...restProps
    }: SidebarProps = $props();

    let currentWidth = $state<number | undefined>(undefined);

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
        },
        get width() {
            return currentWidth;
        },
    });

    let edges = $derived<("right")[]>(expanded && resizable ? ["right"] : []);

    function handleCollapse() {
        expanded = false;
    }

    function handleSizeChange(size: PanelSize) {
        currentWidth = size.width;
        if (size.width !== undefined) {
            onWidthChange?.(size.width);
        }
    }

    function handleResizeEnd(size: PanelSize) {
        currentWidth = size.width;
        if (size.width !== undefined) {
            onResizeEnd?.(size.width);
        }
    }
</script>

<ResizablePanel
    bind:ref
    data-slot="sidebar-root"
    data-expanded={expanded}
    data-collapsible={collapsible}
    {edges}
    {initialWidth}
    {minWidth}
    {maxWidth}
    {storageKey}
    collapseWidthBelowMin={true}
    {collapseThresholdRatio}
    onCollapse={handleCollapse}
    onSizeChange={handleSizeChange}
    onResizeEnd={handleResizeEnd}
    handleAriaLabel={() => "Resize sidebar"}
    class={cn(
        "flex flex-col h-full border-r border-border bg-surface-container-low select-none shrink-0 transition-[width] duration-300 ease-in-out data-[resizing=true]:transition-none",
        expanded
            ? (resizable ? "" : "w-60")
            : collapsible === "icon"
              ? "w-16 overflow-hidden"
              : "w-0 overflow-hidden border-r-0",
        className,
    )}
    {...restProps}
>
    {@render children?.()}
</ResizablePanel>

<style>
    :global([data-slot="sidebar-root"][data-resizing="true"]) {
        transition: none !important;
    }
</style>
