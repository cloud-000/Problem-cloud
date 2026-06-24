<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { type VariantProps, tv } from "tailwind-variants";

    export type TriState = "off" | "neutral" | "on";

    export const triStateSwitchVariants = tv({
        base: "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 outline-none",
        variants: {
            size: {
                default: "h-6 w-14",
                sm: "h-5 w-11",
                lg: "h-7 w-18",
            },
            state: {
                off: "bg-input/40 dark:bg-input/20",
                neutral: "bg-secondary/60 dark:bg-secondary/40",
                on: "bg-primary-foreground/90",
            }
        },
        defaultVariants: {
            size: "default",
        },
    });

    export const triStateThumbVariants = tv({
        base: "pointer-events-none block rounded-full bg-surface-container-lowest shadow-lg ring-0 transition-transform duration-200 ease-out",
        variants: {
            size: {
                default: "size-5",
                sm: "size-4",
                lg: "size-6",
            },
            state: {
                off: "translate-x-0",
                neutral: "",
                on: "",
            }
        },
        compoundVariants: [
            // Default size positions
            { size: "default", state: "neutral", class: "translate-x-4" },
            { size: "default", state: "on", class: "translate-x-8" },
            // Small size positions
            { size: "sm", state: "neutral", class: "translate-x-3" },
            { size: "sm", state: "on", class: "translate-x-6" },
            // Large size positions
            { size: "lg", state: "neutral", class: "translate-x-[22px]" },
            { size: "lg", state: "on", class: "translate-x-11" },
        ],
        defaultVariants: {
            size: "default",
        },
    });

    export type TriStateSwitchSize = VariantProps<typeof triStateSwitchVariants>["size"];

    export type TriStateSwitchProps = WithElementRef<HTMLButtonAttributes> & {
        size?: TriStateSwitchSize;
        value?: TriState;
    };
</script>

<script lang="ts">
    let {
        class: className,
        size = "default",
        value = $bindable("neutral"),
        ref = $bindable(null),
        disabled = false,
        onclick,
        ...restProps
    }: TriStateSwitchProps = $props();

    function handleToggle(e: Parameters<NonNullable<TriStateSwitchProps["onclick"]>>[0]) {
        if (disabled) return;
        
        // Cycle states: off -> neutral -> on -> off
        if (value === "off") {
            value = "neutral";
        } else if (value === "neutral") {
            value = "on";
        } else {
            value = "off";
        }
        
        onclick?.(e);
    }
</script>

<button
    bind:this={ref}
    type="button"
    role="checkbox"
    aria-checked={value === "neutral" ? "mixed" : value === "on" ? "true" : "false"}
    data-state={value}
    {disabled}
    class={cn(triStateSwitchVariants({ size, state: value }), className)}
    onclick={handleToggle}
    {...restProps}
>
    <span
        data-state={value}
        class={cn(triStateThumbVariants({ size, state: value }), "flex items-center justify-center transition-colors")}
    >
        {#if value === "off"}
            <svg class="size-2.5 opacity-40 text-muted-foreground" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="5" cy="5" r="3" />
            </svg>
        {:else if value === "neutral"}
            <svg class="size-2.5 text-secondary-container" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="2" y1="5" x2="8" y2="5" />
            </svg>
        {:else if value === "on"}
            <svg class="size-2.5 text-primary-foreground" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 5.5 L4.5 8 L8 3" />
            </svg>
        {/if}
    </span>
</button>
