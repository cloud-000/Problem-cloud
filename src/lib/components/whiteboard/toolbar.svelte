<script lang="ts" module>
    import type { WhiteboardToolKind } from "$lib/state/whiteboard.svelte";

    const TOOLS: { kind: WhiteboardToolKind; icon: string; title: string }[] = [
        { kind: "select", icon: "arrow_selector_tool", title: "Select / marquee" },
        { kind: "pan", icon: "pan_tool", title: "Pan canvas" },
        { kind: "pen", icon: "draw", title: "Freehand pen" },
        { kind: "line", icon: "timeline", title: "Line" },
        { kind: "rectangle", icon: "rectangle", title: "Rectangle" },
        { kind: "arc", icon: "architecture", title: "Compass / arc" },
        { kind: "point", icon: "fiber_manual_record", title: "Point" },
        { kind: "label", icon: "text_fields", title: "Label" },
        { kind: "eraser", icon: "ink_eraser", title: "Eraser" },
    ];
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { hasWhiteboardInspector } from "./control-policy";

    let {
        store,
        class: className,
        orientation = "horizontal",
        showPan = true,
        onProperties,
        propertiesOpen = false,
    }: {
        store: WhiteboardStore;
        class?: string;
        orientation?: "horizontal" | "vertical";
        showPan?: boolean;
        onProperties?: () => void;
        propertiesOpen?: boolean;
    } = $props();

    const propertiesAvailable = $derived(hasWhiteboardInspector(store));
</script>

<div
    class={cn(
        "flex items-center gap-0.5 rounded-xl border border-border/60 bg-surface-container-lowest/95 p-1 shadow-sm backdrop-blur-(--backdrop-blur)",
        orientation === "vertical" ? "flex-col" : "flex-row overflow-x-auto",
        className,
    )}
    role="toolbar"
    aria-label="Whiteboard tools"
    aria-orientation={orientation}
>
    {#each TOOLS as tool (tool.kind)}
        {#if showPan || tool.kind !== "pan"}
            <Button
                variant={store.toolKind === tool.kind ? "default" : "ghost"}
                size={orientation === "horizontal" ? "icon-lg" : "icon-sm"}
                title={tool.title}
                aria-label={tool.title}
                aria-pressed={store.toolKind === tool.kind}
                onclick={() => store.setTool(tool.kind)}
            >
                <Icon name={tool.icon} />
            </Button>
        {/if}
    {/each}

    {#if onProperties && propertiesAvailable}
        <div class={orientation === "vertical" ? "my-1 h-px w-6 bg-border/60" : "mx-1 h-6 w-px shrink-0 bg-border/60"}></div>
        <Button
            variant={propertiesOpen ? "default" : "ghost"}
            size={orientation === "horizontal" ? "icon-lg" : "icon-sm"}
            title="Properties"
            aria-label="Open properties"
            aria-expanded={propertiesOpen}
            onclick={onProperties}
        >
            <span class="relative flex size-4 items-center justify-center">
                <Icon name="tune" />
                <span
                    class="absolute -bottom-1 -right-1 size-2 rounded-full border border-surface-container-lowest"
                    style:background-color={store.strokeColor}
                ></span>
            </span>
        </Button>
    {/if}
</div>
