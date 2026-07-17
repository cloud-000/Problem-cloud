<script lang="ts">
    import { scale } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Modal } from "$lib/components/modal";
    import { Theme } from "$lib/utils/Theme.svelte";

    let {
        imageSrc,
        alt = "Image",
        code = "",
        autoInvert = true,
        class: className,
    }: {
        imageSrc: string;
        alt?: string;
        code?: string;
        autoInvert?: boolean;
        class?: string;
    } = $props();

    let view = $state<"image" | "code">("image");
    let expanded = $state(false);

    // State to track user's manual override of the theme's default inversion.
    // If null, it defaults to auto-inverting in dark mode — right for line-art
    // diagrams on white, but callers pass autoInvert={false} for real photos
    // that should never invert unless the user asks.
    let userInverted = $state<boolean | null>(null);
    let inverted = $derived(userInverted ?? (autoInvert && Theme.isDark));

    // Luminance-only inversion: flips black<->white backgrounds while keeping
    // colored strokes roughly true. Applied to the <img> only.
    const INVERT_STYLE = "filter: invert(1) hue-rotate(180deg)";
</script>

<div class={cn("group relative my-3", className)}>
    {#if view === "image"}
        <button
            type="button"
            class="block w-full cursor-zoom-in"
            title="Click to expand"
            onclick={() => (expanded = true)}
        >
            <img
                src={imageSrc}
                {alt}
                style={inverted ? INVERT_STYLE : ""}
                class="block max-h-[300px] max-w-full object-contain mx-auto rounded-lg select-none"
            />
        </button>
    {:else}
        <pre
            class="block font-mono text-sm leading-relaxed p-4 rounded-lg bg-surface-container-low/50 border border-border/60 overflow-x-auto text-foreground max-h-[250px]"><code
                >{code}</code
            ></pre>
    {/if}

    <!-- Hover toolbar -->
    <div
        class="absolute right-2 top-2 flex gap-1 rounded-lg border border-border/60 bg-surface-container-lowest/90 p-1 opacity-0 shadow-xs backdrop-blur-(--backdrop-blur) transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
        {#if code}
            <Button
                variant="ghost"
                size="icon-xs"
                title={view === "image" ? "Show code" : "Show image"}
                onclick={() => (view = view === "image" ? "code" : "image")}
            >
                <Icon name={view === "image" ? "code" : "image"} />
            </Button>
        {/if}
        {#if view === "image"}
            <Button
                variant="ghost"
                size="icon-xs"
                title={inverted ? "Light" : "Dark"}
                onclick={() => (userInverted = !inverted)}
            >
                <Icon name="invert_colors" fill={inverted} />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                title="Expand"
                onclick={() => (expanded = true)}
            >
                <Icon name="open_in_full" />
            </Button>
        {/if}
    </div>
</div>

<!-- Fullscreen lightbox: a chromeless (bare) Modal that owns the backdrop,
     Escape handling, scroll-lock, and backdrop-click close. -->
<Modal bind:open={expanded} variant="bare" aria-label="Expanded image">
    <img
        src={imageSrc}
        {alt}
        style={inverted ? INVERT_STYLE : ""}
        class="max-h-full max-w-full object-contain rounded-lg select-none"
        transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}
    />
    <Button
        variant="ghost"
        size="icon"
        class="absolute right-4 top-4 bg-surface-container-lowest/90 text-foreground"
        title="Close"
        onclick={() => (expanded = false)}
    >
        <Icon name="close" />
    </Button>
</Modal>
