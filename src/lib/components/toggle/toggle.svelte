<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { type VariantProps, tv } from "tailwind-variants";

    export const toggleVariants = tv({
        base: "focus-visible:border-ring focus-visible:ring-ring/50 rounded-md text-sm font-medium focus-visible:ring-3 active:translate-y-px inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 gap-1.5 border border-transparent",
        variants: {
            variant: {
                default: "hover:bg-muted text-muted-foreground hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
                outline: "border-border hover:bg-muted text-muted-foreground hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary/20 shadow-sm",
                ghost: "hover:bg-muted/50 text-muted-foreground hover:text-foreground data-[state=on]:bg-surface-container data-[state=on]:text-foreground",
            },
            size: {
                default: "h-9 px-3",
                sm: "h-8 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
                lg: "h-10 px-4 text-base [&_svg:not([class*='size-'])]:size-4.5",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    });

    export type ToggleVariant = VariantProps<typeof toggleVariants>["variant"];
    export type ToggleSize = VariantProps<typeof toggleVariants>["size"];

    export type ToggleProps = WithElementRef<HTMLButtonAttributes> & {
        variant?: ToggleVariant;
        size?: ToggleSize;
        pressed?: boolean;
    };
</script>

<script lang="ts">
    let {
        class: className,
        variant = "default",
        size = "default",
        pressed = $bindable(false),
        ref = $bindable(null),
        disabled = false,
        onclick,
        children,
        ...restProps
    }: ToggleProps = $props();

    function handleToggle(e: Parameters<NonNullable<ToggleProps["onclick"]>>[0]) {
        if (disabled) return;
        pressed = !pressed;
        onclick?.(e);
    }
</script>

<button
    bind:this={ref}
    type="button"
    class={cn(toggleVariants({ variant, size }), className)}
    aria-pressed={pressed}
    data-state={pressed ? "on" : "off"}
    {disabled}
    onclick={handleToggle}
    {...restProps}
>
    {@render children?.()}
</button>
