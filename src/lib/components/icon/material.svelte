<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";

    export type IconProps = WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
        name?: string;
        fill?: boolean;
        fontsize?: string | number;
        color?: string;
        weight?: number;
        grade?: number;
        opticalSize?: number;
    };
</script>

<script lang="ts">
    let {
        ref = $bindable(null),
        class: className,
        name,
        fill = false,
        fontsize,
        color,
        weight,
        grade,
        opticalSize,
        style,
        children,
        ...restProps
    }: IconProps = $props();

    // Construct font-variation-settings based on parameters.
    let variationSettings = $derived.by(() => {
        const settings: string[] = [];
        
        // Fill axis: 0 for outline, 1 for filled
        settings.push(`'FILL' ${fill ? 1 : 0}`);
        
        if (weight !== undefined) {
            settings.push(`'wght' ${weight}`);
        }
        if (grade !== undefined) {
            settings.push(`'GRAD' ${grade}`);
        }
        if (opticalSize !== undefined) {
            settings.push(`'opsz' ${opticalSize}`);
        }
        
        return settings.join(", ");
    });

    // Merge custom styles with color, font-size, and font-variation-settings
    let computedStyle = $derived.by(() => {
        const styles: string[] = [];
        
        if (color) {
            styles.push(`color: ${color}`);
        }
        
        if (fontsize !== undefined) {
            const fs = typeof fontsize === "number" ? `${fontsize}px` : fontsize;
            styles.push(`font-size: ${fs}`);
        }
        
        if (variationSettings) {
            styles.push(`font-variation-settings: ${variationSettings}`);
        }
        
        if (style) {
            styles.push(style);
        }
        
        return styles.length > 0 ? styles.join("; ") : undefined;
    });
</script>

<span
    bind:this={ref}
    class={cn("material-symbols-rounded inline-flex items-center justify-center align-middle leading-none size-[1em] select-none", className)}
    style={computedStyle}
    {...restProps}
>
    {#if name}
        {name}
    {:else if children}
        {@render children()}
    {/if}
</span>
