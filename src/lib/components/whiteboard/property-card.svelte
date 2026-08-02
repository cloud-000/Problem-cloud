<script lang="ts" module>
    const COLORS = [
        { name: "Black", value: "#000000" },
        { name: "Gray", value: "#808080" },
        { name: "White", value: "#ffffff" },
        { name: "Red", value: "#ff0000" },
        { name: "Orange", value: "#ff8000" },
        { name: "Green", value: "#00ff00" },
        { name: "Blue", value: "#0000ff" },
        { name: "Purple", value: "#800080" },
    ];
    const DASHES = [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dash" },
        { value: "dotted", label: "Dot" },
        { value: "longdashed", label: "Long" },
    ];
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Switch } from "$lib/components/toggle";
    import type { EditorPropertyId, EditorPropertyValue, ResolvedEditorProperty } from "$lib/asy/editor-properties";
    import type { WhiteboardStore } from "$lib/state/whiteboard.svelte";

    let {
        store,
        class: className,
        onClose,
        docked = false,
    }: {
        store: WhiteboardStore;
        class?: string;
        onClose?: () => void;
        docked?: boolean;
    } = $props();

    const properties = $derived(store.inspectorProperties);
    const fillEnabled = $derived(properties.find(({ id }) => id === "fillEnabled"));
    const dimension = $derived(store.selectedDimensionId
        ? store.dimensionGlyphs.find(({ id }) => id === store.selectedDimensionId)
        : undefined);

    function update(id: EditorPropertyId, value: EditorPropertyValue) {
        store.setInspectorProperty(id, value);
    }

    function begin() {
        store.beginPropertyEdit();
    }

    function commit() {
        store.commitPropertyEdit();
    }

    function cancel() {
        store.cancelPropertyEdit();
    }

    function numberFrom(event: Event): number {
        return Number((event.currentTarget as HTMLInputElement).value);
    }

    function presets(id: EditorPropertyId): number[] {
        if (id === "lineWidth") return [2, 6, 12];
        if (id === "pointSize") return [2, 4, 8];
        if (id === "eraserSize") return [6, 12, 24];
        return [];
    }

    function moveSwatchFocus(event: KeyboardEvent) {
        if (!event.key.startsWith("Arrow")) return;
        const buttons = Array.from(
            (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>("button[data-swatch]") ?? [],
        );
        const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
    }

    function shouldHide(property: ResolvedEditorProperty): boolean {
        return (property.id === "fillColor" || property.id === "fillOpacity") &&
            fillEnabled !== undefined && !fillEnabled.mixed && !Boolean(fillEnabled.value);
    }
</script>

<section
    class={cn(
        "w-60 border border-border/60 bg-surface-container-lowest/97 backdrop-blur-(--backdrop-blur)",
        docked
            ? "flex h-full flex-col rounded-none border-y-0 border-r-0 shadow-none"
            : "rounded-xl shadow-lg",
        className,
    )}
    aria-label="Whiteboard properties"
>
    <header class="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div class="min-w-0">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Properties</p>
            <div class="flex items-center gap-1.5">
                <h2 class="truncate text-sm font-semibold capitalize">{store.inspectorTitle}</h2>
                {#if store.inspectorClosed}
                    <span class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        Closed
                    </span>
                {/if}
            </div>
        </div>
        {#if onClose}
            <Button variant="ghost" size="icon-xs" aria-label="Close properties" onclick={onClose}>
                <Icon name="close" />
            </Button>
        {/if}
    </header>

    <div class={cn(
        "space-y-4 overflow-y-auto p-3",
        docked ? "min-h-0 flex-1" : "max-h-[min(70vh,34rem)]",
    )}>
        {#if dimension}
            <div class="space-y-1.5 border-b border-border/60 pb-3">
                <label class="text-xs font-medium" for="whiteboard-dimension-value">
                    {dimension.mode === "driving" ? "Driving length" : "Reference length"}
                </label>
                <Input
                    id="whiteboard-dimension-value"
                    type="number"
                    min="0"
                    step="0.1"
                    value={dimension.value}
                    disabled={dimension.mode === "reference"}
                    onchange={(event) => store.editDimension(dimension.id, numberFrom(event))}
                />
            </div>
        {/if}
        {#if properties.length === 0}
            <p class="py-5 text-center text-xs leading-relaxed text-muted-foreground">
                {store.selection.length > 0
                    ? "This element has no editable visual properties."
                    : "Select an object or choose a drawing tool to edit its properties."}
            </p>
        {:else}
            {#each properties as property (property.id)}
                {#if !shouldHide(property)}
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between gap-2">
                            <label class="text-xs font-medium" for={`whiteboard-${property.id}`}>{property.label}</label>
                            {#if property.mixed}<span class="text-[10px] text-muted-foreground">Mixed</span>{/if}
                        </div>

                        {#if property.control === "color"}
                            <div class="grid grid-cols-9 gap-1" role="radiogroup" aria-label={property.label}>
                                {#each COLORS as color (color.value)}
                                    <button
                                        type="button"
                                        data-swatch
                                        role="radio"
                                        aria-label={color.name}
                                        aria-checked={!property.mixed && property.value === color.value}
                                        tabindex={!property.mixed && property.value === color.value ? 0 : -1}
                                        class={cn(
                                            "size-5 rounded-full border border-border/70 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring",
                                            !property.mixed && property.value === color.value && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                                        )}
                                        style:background-color={color.value}
                                        onclick={() => update(property.id, color.value)}
                                        onkeydown={moveSwatchFocus}
                                    ></button>
                                {/each}
                                <label
                                    class="relative size-5 cursor-pointer overflow-hidden rounded-full border border-border/70"
                                    style="background: conic-gradient(#f33, #ff3, #3f3, #3ff, #33f, #f3f, #f33)"
                                    title="Custom color"
                                >
                                    <input
                                        id={`whiteboard-${property.id}`}
                                        class="absolute inset-0 size-full cursor-pointer opacity-0"
                                        type="color"
                                        value={String(property.value)}
                                        aria-label={`Custom ${property.label.toLowerCase()}`}
                                        onfocus={begin}
                                        onpointerdown={begin}
                                        oninput={(event) => update(property.id, (event.currentTarget as HTMLInputElement).value)}
                                        onchange={commit}
                                    />
                                </label>
                            </div>
                        {:else if property.control === "toggle"}
                            <Switch
                                id={`whiteboard-${property.id}`}
                                size="sm"
                                checked={!property.mixed && Boolean(property.value)}
                                aria-label={property.label}
                                onclick={() => update(property.id, property.mixed ? true : !Boolean(property.value))}
                            />
                        {:else if property.control === "dash"}
                            <div class="grid grid-cols-4 gap-1" id={`whiteboard-${property.id}`}>
                                {#each DASHES as dash (dash.value)}
                                    <button
                                        type="button"
                                        class={cn(
                                            "h-7 rounded-md border border-border/60 px-1 text-[10px] hover:bg-muted",
                                            !property.mixed && property.value === dash.value && "border-primary bg-primary/10 text-primary",
                                        )}
                                        aria-pressed={!property.mixed && property.value === dash.value}
                                        onclick={() => update(property.id, dash.value)}
                                    >{dash.label}</button>
                                {/each}
                            </div>
                        {:else if property.control === "text"}
                            <Input
                                id={`whiteboard-${property.id}`}
                                value={property.mixed ? "" : String(property.value)}
                                placeholder={property.mixed ? "Mixed values" : undefined}
                                onfocus={begin}
                                oninput={(event) => update(property.id, (event.currentTarget as HTMLInputElement).value)}
                                onchange={commit}
                                onkeydown={(event) => {
                                    if (event.key === "Escape") cancel();
                                }}
                            />
                        {:else}
                            {@const quickValues = presets(property.id)}
                            {#if quickValues.length > 0}
                                <div class="grid grid-cols-3 gap-1">
                                    {#each quickValues as value (value)}
                                        <button
                                            type="button"
                                            class={cn(
                                                "flex h-7 items-center justify-center rounded-md border border-border/60 hover:bg-muted",
                                                !property.mixed && Number(property.value) === value && "border-primary bg-primary/10",
                                            )}
                                            aria-label={`${property.label} ${value}`}
                                            aria-pressed={!property.mixed && Number(property.value) === value}
                                            onclick={() => update(property.id, value)}
                                        >
                                            {#if property.id === "pointSize" || property.id === "eraserSize"}
                                                <span
                                                    class="rounded-full bg-foreground"
                                                    style:width={`${Math.max(3, Math.min(14, value / (property.id === "eraserSize" ? 2 : 1)))}px`}
                                                    style:height={`${Math.max(3, Math.min(14, value / (property.id === "eraserSize" ? 2 : 1)))}px`}
                                                ></span>
                                            {:else}
                                                <span class="w-8 rounded-full bg-foreground" style:height={`${Math.max(1, Math.min(8, value / 2))}px`}></span>
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                            <div class="grid grid-cols-[1fr_3.75rem] items-center gap-2">
                                <input
                                    id={`whiteboard-${property.id}`}
                                    class="h-2 w-full cursor-pointer accent-primary"
                                    type="range"
                                    min={property.min}
                                    max={property.max}
                                    step={property.step}
                                    value={Number(property.value)}
                                    onpointerdown={begin}
                                    oninput={(event) => update(property.id, numberFrom(event))}
                                    onchange={commit}
                                    onkeydown={(event) => {
                                        begin();
                                        if (event.key === "Escape") cancel();
                                        else queueMicrotask(commit);
                                    }}
                                />
                                <Input
                                    type="number"
                                    min={property.min}
                                    max={property.max}
                                    step={property.step}
                                    value={property.mixed ? "" : Number(property.value)}
                                    aria-label={`${property.label} value`}
                                    onfocus={begin}
                                    onchange={(event) => {
                                        update(property.id, numberFrom(event));
                                        commit();
                                    }}
                                    onkeydown={(event) => {
                                        if (event.key === "Escape") cancel();
                                    }}
                                    class="h-8 px-2 text-xs"
                                />
                            </div>
                        {/if}
                    </div>
                {/if}
            {/each}
        {/if}
    </div>
</section>
