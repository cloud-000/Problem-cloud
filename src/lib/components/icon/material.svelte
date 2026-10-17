<script lang="ts" module>
    import { cn, type WithElementRef } from "#lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { iconHref } from "./assets.js";

    export type IconProps = WithElementRef<Omit<HTMLAttributes<HTMLSpanElement>, "children">> & {
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
        fontsize = 24,
        color,
        weight = 400,
        grade = 0,
        opticalSize = 24,
        style,
        ...restProps
    }: IconProps = $props();

    let href = $derived(name ? iconHref(name, { fill, weight, grade, opticalSize }) : "");
    let computedStyle = $derived([
        color ? `color: ${color}` : "",
        fontsize !== undefined ? `font-size: ${typeof fontsize === "number" ? `${fontsize}px` : fontsize}` : "",
        style,
    ].filter(Boolean).join("; "));
</script>

<span
    bind:this={ref}
    data-slot="icon"
    class={cn("inline-flex items-center justify-center align-middle leading-none size-[1em] select-none", className)}
    style={computedStyle || undefined}
    {...restProps}
>
    {#if href}
        <!-- Like the former font glyph, artwork follows fontsize independently
             of the wrapper's box and ancestor buttons' generic SVG sizing. -->
        <svg style="width: 1em; height: 1em; flex-shrink: 0;" fill="currentColor" aria-hidden="true" focusable="false">
            <use {href} />
        </svg>
        <span class="sr-only">{name}</span>
    {/if}
</span>
