<script lang="ts" module>
    import type { WhiteboardToolKind } from "$lib/state/whiteboard.svelte";

    const TOOLS: { kind: WhiteboardToolKind; icon: string; title: string }[] = [
        { kind: "select", icon: "arrow_selector_tool", title: "Select / marquee" },
        { kind: "pan", icon: "pan_tool", title: "Pan canvas" },
        { kind: "pen", icon: "draw", title: "Freehand pen" },
        { kind: "line", icon: "timeline", title: "Line" },
        { kind: "rectangle", icon: "rectangle", title: "Rectangle" },
        { kind: "arc", icon: "architecture", title: "Compass / arc (4 clicks)" },
        { kind: "point", icon: "fiber_manual_record", title: "Point" },
        { kind: "label", icon: "text_fields", title: "Label" },
        { kind: "eraser", icon: "ink_eraser", title: "Eraser" },
    ];

    const COLORS: { name: string; css: string }[] = [
        { name: "black", css: "#111" },
        { name: "red", css: "#e11" },
        { name: "blue", css: "#16c" },
        { name: "green", css: "#0a0" },
        { name: "orange", css: "#f80" },
    ];

    const WIDTHS: { value: number; label: string }[] = [
        { value: 1, label: "S" },
        { value: 2, label: "M" },
        { value: 4, label: "L" },
    ];
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";

    let {
        store,
        class: className,
        actions,
        compact = false,
        showPan = true,
    }: {
        store: WhiteboardStore;
        class?: string;
        /** Host-provided extra actions (e.g. export SVG/PNG, close). */
        actions?: import("svelte").Snippet;
        /** Tool-first chrome for overlays and narrow utility panels. */
        compact?: boolean;
        /** Hide navigation controls when an overlay must stay locked to its host image. */
        showPan?: boolean;
    } = $props();

    let copied = $state(false);

    function setColor(name: string) {
        store.pen = { ...store.pen, namedColor: name, color: undefined };
    }
    function setWidth(value: number) {
        store.pen = { ...store.pen, lineWidth: value };
    }
    function toggleDash() {
        store.pen = { ...store.pen, dash: store.pen.dash === "dashed" ? "solid" : "dashed" };
    }

    async function copyAsy() {
        try {
            await navigator.clipboard.writeText(store.toAsy());
            copied = true;
            setTimeout(() => (copied = false), 1200);
        } catch {
            copied = false;
        }
    }
</script>

<div
    class={cn(
        "flex flex-wrap items-center gap-0.5 rounded-lg border border-border/60 bg-surface-container-lowest/95 p-1 shadow-xs backdrop-blur-(--backdrop-blur)",
        className
    )}
    role="toolbar"
    aria-label="Whiteboard tools"
>
    <!-- Tools -->
    {#each TOOLS as tool (tool.kind)}
        {#if showPan || tool.kind !== "pan"}
            <Button
                variant={store.toolKind === tool.kind ? "default" : "ghost"}
                size="icon-sm"
                title={tool.title}
                aria-pressed={store.toolKind === tool.kind}
                onclick={() => store.setTool(tool.kind)}
            >
                <Icon name={tool.icon} />
            </Button>
        {/if}
    {/each}

    {#if !compact}
        <div class="mx-1 h-6 w-px bg-border/60"></div>

        {#each COLORS as color (color.name)}
            <button
                type="button"
                title={color.name}
                aria-label={color.name}
                aria-pressed={store.pen.namedColor === color.name}
                class={cn(
                    "size-5 rounded-full border transition-transform hover:scale-110",
                    store.pen.namedColor === color.name ? "border-foreground ring-2 ring-primary" : "border-border/60"
                )}
                style="background-color: {color.css}"
                onclick={() => setColor(color.name)}
            ></button>
        {/each}

        <div class="mx-1 h-6 w-px bg-border/60"></div>

        {#each WIDTHS as w (w.value)}
            <Button
                variant={(store.pen.lineWidth ?? 1) === w.value ? "default" : "ghost"}
                size="icon-sm"
                title={"Width " + w.label}
                onclick={() => setWidth(w.value)}
            >
                <span class="text-xs font-semibold">{w.label}</span>
            </Button>
        {/each}

        <Button
            variant={store.pen.dash === "dashed" ? "default" : "ghost"}
            size="icon-sm"
            title="Dashed"
            onclick={toggleDash}
        >
            <Icon name="more_horiz" />
        </Button>
    {/if}

    <div class="mx-1 h-6 w-px bg-border/60"></div>

    <!-- History / edit -->
    <Button variant="ghost" size="icon-sm" title="Undo" disabled={!store.canUndo} onclick={() => store.undo()}>
        <Icon name="undo" />
    </Button>
    <Button variant="ghost" size="icon-sm" title="Redo" disabled={!store.canRedo} onclick={() => store.redo()}>
        <Icon name="redo" />
    </Button>
    <Button
        variant="ghost"
        size="icon-sm"
        title="Delete selection"
        disabled={store.selection.length === 0}
        onclick={() => store.deleteSelected()}
    >
        <Icon name="delete" />
    </Button>
    <Button variant="ghost" size="icon-sm" title="Clear all" onclick={() => store.clearAll()}>
        <Icon name="delete_sweep" />
    </Button>

    {#if !compact || actions}
        <div class="mx-1 h-6 w-px bg-border/60"></div>
    {/if}

    {#if !compact}
        <Button variant="ghost" size="icon-sm" title={copied ? "Copied!" : "Copy Asymptote"} onclick={copyAsy}>
            <Icon name={copied ? "check" : "content_copy"} />
        </Button>
    {/if}

    {@render actions?.()}
</div>
