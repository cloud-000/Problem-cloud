<script lang="ts" module>
    import type { Snippet } from "svelte";
    import type { FloatingAlign, FloatingRect, FloatingSide } from "./place-floating";

    /**
     * How the surface was summoned. `center` is the anchorless (keyboard) case;
     * `element` anchors to whatever was clicked; `sheet` is the small-screen
     * bottom-anchored form. `pointer` and `selection` are additive later — the
     * placement math already supports an arbitrary anchor rect.
     */
    export type FloatingPlacement = "center" | "element" | "sheet";

    export interface FloatingSurfaceProps {
        open?: boolean;
        placement?: FloatingPlacement;
        /** Required by `placement="element"`; ignored otherwise. */
        anchor?: HTMLElement | FloatingRect | null;
        side?: FloatingSide;
        align?: FloatingAlign;
        gap?: number;
        padding?: number;
        topRatio?: number;
        /** Applied to the positioned element. Pass `pointer-events-none` for a stack of detached pills. */
        class?: string;
        label?: string;
        zIndex?: number;
        /** Escape, or a pointer press outside the surface. */
        onDismiss?: () => void;
        children: Snippet;
    }
</script>

<script lang="ts">
    import { cn } from "$lib/utils";
    import { placeFloating } from "./place-floating";

    let {
        open = false,
        placement = "center",
        anchor = null,
        side = "bottom",
        align = "start",
        gap = 8,
        padding = 12,
        topRatio = 0.5,
        class: className,
        label,
        zIndex = 50,
        onDismiss,
        children,
    }: FloatingSurfaceProps = $props();

    let surface = $state<HTMLElement | null>(null);
    let surfaceWidth = $state(0);
    let surfaceHeight = $state(0);
    let viewportWidth = $state(0);
    let viewportHeight = $state(0);

    let anchorRect = $derived.by<FloatingRect | null>(() => {
        if (placement !== "element" || !anchor) return null;
        if (anchor instanceof HTMLElement) {
            const rect = anchor.getBoundingClientRect();
            return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        }
        return anchor;
    });

    // Nothing is painted until the surface has been measured once, so it never
    // flashes at the top-left corner on the way to its real position.
    let measured = $derived(surfaceWidth > 0 && surfaceHeight > 0);
    let position = $derived(
        placeFloating(
            anchorRect,
            { width: surfaceWidth, height: surfaceHeight },
            { width: viewportWidth, height: viewportHeight },
            { side, align, gap, padding, topRatio },
        ),
    );

    function handleKeydown(event: KeyboardEvent) {
        // ModalContainer is a true modal and wins; it marks the event handled.
        if (!open || event.defaultPrevented || event.key !== "Escape") return;
        event.preventDefault();
        onDismiss?.();
    }

    function handlePointerDown(event: PointerEvent) {
        if (!open || !surface) return;
        if (surface.contains(event.target as Node)) return;
        onDismiss?.();
    }
</script>

<svelte:window
    bind:innerWidth={viewportWidth}
    bind:innerHeight={viewportHeight}
    onkeydown={handleKeydown}
    onpointerdown={handlePointerDown}
/>

{#if open}
    <!--
      The wrapper spans the viewport purely to position the surface, so it MUST
      stay pointer-events-none: this is a non-modal surface and the page behind
      it stays fully interactive. A transparent full-screen div that swallows
      clicks looks perfect in a screenshot and breaks every control on the page.
    -->
    <div class="pointer-events-none fixed inset-0" style={`z-index: ${zIndex}`}>
        {#if placement === "sheet"}
            <div
                bind:this={surface}
                role="group"
                aria-label={label}
                class={cn("floating-sheet pointer-events-auto absolute inset-x-0 bottom-0", className)}
            >
                {@render children()}
            </div>
        {:else}
            <div
                bind:this={surface}
                bind:clientWidth={surfaceWidth}
                bind:clientHeight={surfaceHeight}
                role="group"
                aria-label={label}
                class={cn("pointer-events-auto absolute", className)}
                style={`top: ${position.top}px; left: ${position.left}px; visibility: ${
                    measured ? "visible" : "hidden"
                }`}
            >
                {@render children()}
            </div>
        {/if}
    </div>
{/if}

<style>
    .floating-sheet {
        padding-bottom: env(safe-area-inset-bottom);
    }
</style>
