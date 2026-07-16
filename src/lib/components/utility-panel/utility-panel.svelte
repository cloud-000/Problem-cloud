<script lang="ts" module>
    export interface UtilityPanelProps {
        class?: string;
    }
</script>

<script lang="ts">
    import { tick } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { fade } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { cn } from "$lib/utils";
    import { utilityPanel } from "$lib/state/utility-panel.svelte";
    import { ResizablePanel, type PanelSize } from "$lib/components/resizable-panel";

    const DEFAULT_WIDTH = { default: 400, min: 320, max: Number.POSITIVE_INFINITY };
    const DEFAULT_MOBILE_HEIGHT = { defaultRatio: 0.5, minRatio: 0.35, maxRatio: 0.9 };

    let { class: className }: UtilityPanelProps = $props();
    let panel = $state<HTMLElement | null>(null);
    let innerWidth = $state(1280);
    let innerHeight = $state(800);
    const wideQuery = new MediaQuery("(min-width: 1280px)", false);
    const mobilePortraitQuery = new MediaQuery(
        "(max-width: 767px) and (orientation: portrait)",
        false,
    );
    const reducedMotionQuery = new MediaQuery("(prefers-reduced-motion: reduce)", false);
    let isWide = $derived(wideQuery.current);
    let isMobilePortrait = $derived(mobilePortraitQuery.current);
    let reducedMotion = $derived(reducedMotionQuery.current);
    let activeRegistration = $derived(utilityPanel.activeRegistration);
    let open = $derived(Boolean(utilityPanel.activeView && activeRegistration));
    let widthConfig = $derived(activeRegistration?.sizing?.width ?? DEFAULT_WIDTH);
    let mobileHeightConfig = $derived(
        activeRegistration?.sizing?.mobileHeight ?? DEFAULT_MOBILE_HEIGHT,
    );
    let minimumWidth = $derived(Math.min(widthConfig.min, innerWidth));
    let maximumWidth = $derived(
        Math.max(minimumWidth, Math.min(widthConfig.max, innerWidth * 0.6)),
    );
    let minimumHeight = $derived(innerHeight * mobileHeightConfig.minRatio);
    let maximumHeight = $derived(innerHeight * mobileHeightConfig.maxRatio);
    let initialHeight = $derived(innerHeight * mobileHeightConfig.defaultRatio);
    let storageKey = $derived(
        activeRegistration?.sizing?.storageKey ??
            `problem-cloud:utility-panel:${activeRegistration?.view ?? "unknown"}`,
    );

    $effect(() => {
        if (!open || isWide) return;
        void tick().then(() => {
            panel?.querySelector<HTMLElement>(
                "button:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
            )?.focus();
        });
    });

    function handleWindowKeydown(event: KeyboardEvent) {
        if (!open || event.defaultPrevented || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        utilityPanel.close();
    }

    function handlePanelKeydown(event: KeyboardEvent) {
        if (event.key !== "Tab" || isWide || !panel) return;
        const focusable = Array.from(
            panel.querySelectorAll<HTMLElement>(
                "button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
            ),
        ).filter((element) => !element.hidden);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function handleKeydown(event: KeyboardEvent) {
        handleWindowKeydown(event);
        handlePanelKeydown(event);
    }

    function publishSize(size: PanelSize) {
        if (size.width !== undefined) utilityPanel.renderedWidth = size.width;
        if (size.height !== undefined) utilityPanel.renderedHeight = size.height;
    }
</script>

<svelte:window
    bind:innerWidth
    bind:innerHeight
    onkeydown={handleKeydown}
/>

{#if open && activeRegistration}
    {#if !isWide}
        <button
            type="button"
            class="fixed inset-0 z-60 cursor-default bg-black/20 backdrop-blur-[1px]"
            aria-label="Close {activeRegistration.label}"
            onclick={() => utilityPanel.close()}
            transition:fade={{ duration: reducedMotion ? 0 : 200, easing: cubicOut }}
        ></button>
    {/if}

    {#key isMobilePortrait ? "mobile" : "side"}
        <ResizablePanel
            edges={isMobilePortrait ? ["top"] : ["left"]}
            initialWidth={isMobilePortrait ? undefined : widthConfig.default}
            initialHeight={isMobilePortrait ? initialHeight : undefined}
            minWidth={minimumWidth}
            maxWidth={maximumWidth}
            minHeight={minimumHeight}
            maxHeight={maximumHeight}
            {storageKey}
            revealAxis={isMobilePortrait ? "vertical" : "horizontal"}
            collapseWidthBelowMin={!isMobilePortrait}
            onCollapse={() => utilityPanel.close()}
            onSizeChange={publishSize}
            bind:ref={panel}
            class={cn(
                "utility-panel-shell fixed inset-y-0 right-0 z-60 flex shrink-0 flex-col border-l border-border/70 bg-background shadow-2xl xl:relative xl:z-30 xl:shadow-none",
                isMobilePortrait
                    ? "transition-[height] duration-200 motion-reduce:transition-none"
                    : "transition-[width] duration-200 motion-reduce:transition-none",
                className,
            )}
        >
            <aside
                data-slot="utility-panel"
                class="flex h-full w-full min-w-0 flex-col overflow-hidden outline-none"
                role={isWide ? "complementary" : "dialog"}
                aria-modal={isWide ? undefined : "true"}
                aria-label={activeRegistration.label}
            >
                <div class="min-h-0 flex-1">{@render activeRegistration.content()}</div>
            </aside>
        </ResizablePanel>
    {/key}
{/if}

<style>
    @media (max-width: 767px) and (orientation: portrait) {
        :global(.utility-panel-shell) {
            inset: auto 0 0 0;
            width: 100%;
            border-left: 0;
            border-top: 1px solid var(--color-border);
            border-radius: var(--radius-xl) var(--radius-xl) 0 0;
            padding-bottom: env(safe-area-inset-bottom);
        }
    }

    :global(.utility-panel-shell[data-resizing="true"]) {
        transition: none;
    }
</style>
