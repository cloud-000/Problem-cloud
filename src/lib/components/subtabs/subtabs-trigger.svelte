<script lang="ts">
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { useSubtabs } from "./subtabs.svelte";
    import { Icon } from "$lib/components/icon/index.js";

    export type SubtabsTriggerProps = WithElementRef<HTMLButtonAttributes> & {
        value: string;
        icon?: string;
        disabled?: boolean;
    };

    let {
        ref = $bindable(null),
        value,
        icon,
        disabled = false,
        class: className,
        children,
        onclick,
        ...restProps
    }: SubtabsTriggerProps = $props();

    const context = useSubtabs();
    const active = $derived(context.value === value);

    function handleClick(e: Parameters<NonNullable<SubtabsTriggerProps["onclick"]>>[0]) {
        if (disabled) return;
        context.value = value;
        onclick?.(e);
    }
</script>

<button
    bind:this={ref}
    type="button"
    role="tab"
    aria-selected={active}
    aria-disabled={disabled ? "true" : undefined}
    tabindex={active && !disabled ? 0 : -1}
    data-value={value}
    data-state={active ? "active" : "inactive"}
    {disabled}
    onclick={handleClick}
    class={cn(
        "inline-flex items-center gap-2 select-none cursor-pointer transition-all outline-none disabled:pointer-events-none disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring/50",
        
        // Line variant
        context.variant === "line" && (context.orientation === "vertical"
            ? "justify-start text-left py-1.5 pr-3 pl-1 border-r-2 border-transparent -mr-px text-sm font-medium disabled:opacity-40"
            : "justify-center py-2 px-1 border-b-2 border-transparent -mb-px text-sm font-medium disabled:opacity-40"),
        context.variant === "line" && active && "text-primary-foreground border-primary-foreground font-semibold",
        context.variant === "line" && !active && "text-muted-foreground hover:text-foreground",

        // Pill variant
        context.variant === "pill" && (context.orientation === "vertical"
            ? "justify-start text-left w-full px-3 py-1.5 text-sm font-medium rounded-lg border border-transparent disabled:opacity-40"
            : "justify-center px-3 py-1.5 text-sm font-medium rounded-md border border-transparent disabled:opacity-40"),
        context.variant === "pill" && active && "bg-surface-container-lowest text-foreground shadow-xs border-border/20",
        context.variant === "pill" && !active && "text-muted-foreground hover:text-foreground hover:bg-surface-container-low/50",

        // Card variant
        context.variant === "card" && (context.orientation === "vertical"
            ? "justify-start text-left py-1.5 pr-3 pl-4 border border-transparent border-r-0 -mr-px rounded-l-lg text-sm font-medium disabled:opacity-40"
            : "justify-center py-2 px-4 border border-transparent border-b-0 -mb-px rounded-t-lg text-sm font-medium disabled:opacity-40"),
        context.variant === "card" && active && "border-border bg-surface-container-lowest text-foreground",
        context.variant === "card" && active && context.orientation === "horizontal" && "border-b-surface-container-lowest",
        context.variant === "card" && active && context.orientation === "vertical" && "border-r-surface-container-lowest",
        context.variant === "card" && !active && "text-muted-foreground hover:bg-muted/40 hover:text-foreground",

        className
    )}
    {...restProps}
>
    {#if icon}
        <Icon name={icon} class="shrink-0 size-4.5" />
    {/if}
    {@render children?.()}
</button>
