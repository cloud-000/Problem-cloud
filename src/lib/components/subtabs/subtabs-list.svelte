<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { useSubtabs } from "./subtabs.svelte";

    let {
        class: className,
        children,
        ...restProps
    }: HTMLAttributes<HTMLDivElement> = $props();

    const context = useSubtabs();
    let containerEl = $state<HTMLDivElement | null>(null);

    function handleKeydown(e: KeyboardEvent) {
        if (!containerEl) return;
        const orientation = context.orientation;

        const isPrev = orientation === "vertical" ? e.key === "ArrowUp" : e.key === "ArrowLeft";
        const isNext = orientation === "vertical" ? e.key === "ArrowDown" : e.key === "ArrowRight";

        if (!isPrev && !isNext) return;

        e.preventDefault();

        // Get all focusable triggers that are not disabled
        const tabs = Array.from(
            containerEl.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')
        );
        if (tabs.length === 0) return;

        // Find currently focused or currently active tab element
        const activeElement = document.activeElement;
        let activeIndex = tabs.indexOf(activeElement as HTMLButtonElement);
        
        if (activeIndex === -1) {
            // Fallback to currently active selected tab
            activeIndex = tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
        }

        let nextIndex = activeIndex;
        if (isPrev) {
            nextIndex = activeIndex === -1 ? tabs.length - 1 : (activeIndex - 1 + tabs.length) % tabs.length;
        } else if (isNext) {
            nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % tabs.length;
        }

        const targetTab = tabs[nextIndex];
        if (targetTab) {
            targetTab.focus();
            const val = targetTab.getAttribute("data-value");
            if (val) {
                context.value = val;
            }
        }
    }
</script>

<div
    bind:this={containerEl}
    role="tablist"
    aria-orientation={context.orientation}
    onkeydown={handleKeydown}
    class={cn(
        "flex shrink-0 select-none",
        // Line styling
        context.variant === "line" && (context.orientation === "vertical" 
            ? "flex-col items-stretch border-r border-border/80 gap-3 pr-3" 
            : "flex-row items-center border-b border-border/80 gap-6"),
        // Pill styling
        context.variant === "pill" && (context.orientation === "vertical"
            ? "flex-col items-stretch p-1.5 rounded-xl bg-surface-container-low border border-border/40 gap-1 w-48"
            : "flex-row items-center p-1 rounded-lg bg-surface-container/60 border border-border/40 w-fit gap-1"),
        // Card styling
        context.variant === "card" && (context.orientation === "vertical"
            ? "flex-col items-stretch border-r border-border/80 gap-1 pr-1"
            : "flex-row items-end border-b border-border/80 gap-1"),
        className
    )}
    {...restProps}
>
    {@render children?.()}
</div>
