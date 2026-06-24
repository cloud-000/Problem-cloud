<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLButtonAttributes } from "svelte/elements";
    import { type VariantProps, tv } from "tailwind-variants";

    export const switchVariants = tv({
        base: "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 bg-input/40 dark:bg-input/20 data-[state=checked]:bg-primary-foreground/90 outline-none",
        variants: {
            size: {
                default: "h-6 w-11",
                sm: "h-5 w-9",
                lg: "h-7 w-14",
            },
        },
        defaultVariants: {
            size: "default",
        },
    });

    export const thumbVariants = tv({
        base: "pointer-events-none block rounded-full bg-surface-container-lowest shadow-lg ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-5",
        variants: {
            size: {
                default: "size-5 data-[state=checked]:translate-x-5",
                sm: "size-4 data-[state=checked]:translate-x-4",
                lg: "size-6 data-[state=checked]:translate-x-7",
            },
        },
        defaultVariants: {
            size: "default",
        },
    });

    export type SwitchSize = VariantProps<typeof switchVariants>["size"];

    export type SwitchProps = WithElementRef<HTMLButtonAttributes> & {
        size?: SwitchSize;
        checked?: boolean;
    };
</script>

<script lang="ts">
    let {
        class: className,
        size = "default",
        checked = $bindable(false),
        ref = $bindable(null),
        disabled = false,
        onclick,
        ...restProps
    }: SwitchProps = $props();

    function handleToggle(e: Parameters<NonNullable<SwitchProps["onclick"]>>[0]) {
        if (disabled) return;
        checked = !checked;
        onclick?.(e);
    }
</script>

<button
    bind:this={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    data-state={checked ? "checked" : "unchecked"}
    {disabled}
    class={cn(switchVariants({ size }), className)}
    onclick={handleToggle}
    {...restProps}
>
    <span
        data-state={checked ? "checked" : "unchecked"}
        class={thumbVariants({ size })}
    ></span>
</button>
