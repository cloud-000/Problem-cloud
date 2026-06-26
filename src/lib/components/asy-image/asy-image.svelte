<script lang="ts">
    import { fade, scale } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Theme } from "$lib/utils/Theme.svelte";

    let {
        imageSrc,
        code = "",
        class: className,
    }: {
        imageSrc: string;
        code?: string;
        class?: string;
    } = $props();

    let view = $state<"image" | "code">("image");
    let expanded = $state(false);

    // State to track user's manual override of the theme's default inversion.
    // If null, it defaults to the active theme's isDark value.
    let userInverted = $state<boolean | null>(null);
    let inverted = $derived(userInverted ?? Theme.isDark);

    // Luminance-only inversion: flips black<->white backgrounds while keeping
    // colored strokes roughly true. Applied to the <img> only.
    const INVERT_STYLE = "filter: invert(1) hue-rotate(180deg)";

    // While the lightbox is open, trap Escape and lock page scroll. The cleanup
    // runs both when it closes and if the component is unmounted while open, so
    // no listener or scroll-lock is ever left dangling.
    $effect(() => {
        if (!expanded) return;

        function onKeydown(event: KeyboardEvent) {
            if (event.key === "Escape") expanded = false;
        }

        document.addEventListener("keydown", onKeydown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", onKeydown);
            document.body.style.overflow = previousOverflow;
        };
    });
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
                alt="Asymptote diagram"
                style={inverted ? INVERT_STYLE : ""}
                class="block max-h-[300px] max-w-full object-contain mx-auto rounded-lg"
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
        class="absolute right-2 top-2 flex gap-1 rounded-lg border border-border/60 bg-surface-container-lowest/90 p-1 opacity-0 shadow-xs backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100"
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

{#if expanded}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
        transition:fade={{ duration: 150, easing: cubicOut }}
        onclick={(event) => {
            // Close only when the backdrop itself (not the image) is clicked.
            if (event.target === event.currentTarget) expanded = false;
        }}
    >
        <img
            src={imageSrc}
            alt="Asymptote diagram"
            style={inverted ? INVERT_STYLE : ""}
            class="max-h-full max-w-full object-contain rounded-lg"
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
    </div>
{/if}
