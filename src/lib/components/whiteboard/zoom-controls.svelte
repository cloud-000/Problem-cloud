<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";

    let {
        percentage,
        onZoomIn,
        onZoomOut,
        onZoomTo,
        onFitScene,
        canFitScene = true,
    }: {
        percentage: number;
        onZoomIn: () => void;
        onZoomOut: () => void;
        onZoomTo: (percentage: number) => void;
        onFitScene: () => void;
        canFitScene?: boolean;
    } = $props();

    function commitZoom(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const requestedPercentage = input.valueAsNumber;
        if (Number.isFinite(requestedPercentage)) {
            onZoomTo(requestedPercentage);
        } else {
            input.value = percentage.toString();
        }
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            commitZoom(event);
            (event.currentTarget as HTMLInputElement).blur();
        }
    }
</script>

<div
    class="pointer-events-auto flex items-center gap-1 rounded-lg border border-border/60 bg-surface-container-lowest/95 p-1 shadow-xs backdrop-blur-(--backdrop-blur)"
    aria-label="Canvas zoom"
>
    <Button variant="ghost" size="icon-sm" title="Zoom out" aria-label="Zoom out" onclick={onZoomOut}>
        <Icon name="remove" />
    </Button>
    <div class="relative min-w-14">
        <Input
            type="number"
            min={20}
            max={1000}
            step={1}
            aria-label="Zoom percentage"
            class="h-7 w-14 appearance-none border-0 bg-transparent px-1 text-center text-xs font-medium tabular-nums shadow-none focus-visible:ring-0"
            value={percentage}
            onchange={commitZoom}
            onkeydown={onKeyDown}
        />
        <span class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
    <Button variant="ghost" size="icon-sm" title="Zoom in" aria-label="Zoom in" onclick={onZoomIn}>
        <Icon name="add" />
    </Button>
    <div class="mx-0.5 h-5 w-px bg-border/60"></div>
    <Button
        variant="ghost"
        size="icon-sm"
        title="Fit scene"
        aria-label="Fit scene"
        disabled={!canFitScene}
        onclick={onFitScene}
    >
        <Icon name="fit_screen" />
    </Button>
</div>
