<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import Toolbar from "./toolbar.svelte";
    import CommandCard from "./command-card.svelte";
    import PropertyCard from "./property-card.svelte";
    import { hasWhiteboardInspector } from "./control-policy";

    let {
        store,
        class: className,
        showPan = true,
        showProperties = true,
    }: {
        store: WhiteboardStore;
        class?: string;
        showPan?: boolean;
        showProperties?: boolean;
    } = $props();

    let root: HTMLDivElement | null = null;
    let propertiesOpen = $state(false);
    const propertiesAvailable = $derived(hasWhiteboardInspector(store));
    const visiblePropertiesOpen = $derived(propertiesOpen && propertiesAvailable);

    function closeProperties() {
        store.commitPropertyEdit();
        propertiesOpen = false;
    }

    function toggleProperties() {
        if (visiblePropertiesOpen) closeProperties();
        else propertiesOpen = true;
    }

    function onDocumentPointerDown(event: PointerEvent) {
        if (propertiesOpen && root && !root.contains(event.target as Node)) closeProperties();
    }

    function onDocumentKeyDown(event: KeyboardEvent) {
        if (propertiesOpen && event.key === "Escape") {
            store.cancelPropertyEdit();
            propertiesOpen = false;
        }
    }

    function attachRoot(node: HTMLDivElement) {
        root = node;
        return () => {
            root = null;
        };
    }
</script>

<svelte:document onpointerdown={onDocumentPointerDown} onkeydown={onDocumentKeyDown} />

<div {@attach attachRoot} class={cn("relative flex min-w-0 items-start gap-2", className)}>
    <Toolbar
        {store}
        {showPan}
        class="min-w-0 flex-1"
        propertiesOpen={visiblePropertiesOpen}
        onProperties={showProperties && propertiesAvailable ? toggleProperties : undefined}
    />
    <CommandCard {store} compact class="shrink-0" />
    {#if showProperties && visiblePropertiesOpen}
        <PropertyCard
            {store}
            onClose={closeProperties}
            class="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-1rem))] max-w-full"
        />
    {/if}
</div>
