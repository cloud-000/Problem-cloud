<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { offlineMode } from "$lib/state/offline-mode.svelte";
    import { cn } from "$lib/utils";

    let {
        showControl = true,
        floating = true,
    }: {
        showControl?: boolean;
        floating?: boolean;
    } = $props();
</script>

{#if showControl}
<label
    class={cn(
        "group inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 type-caption transition-all duration-200 focus-within:ring-2 focus-within:ring-ring/40 focus-within:outline-none",
        offlineMode.isLocal
            ? "border-primary-foreground/30 bg-primary/20 text-foreground shadow-xs"
            : "border-border/80 bg-surface-container-lowest text-muted-foreground hover:bg-surface-container-low hover:text-foreground shadow-xs",
        floating && "fixed right-3 top-3 z-[65] shadow-md backdrop-blur-md"
    )}
    title="Use downloaded content for local pages and new Practice launches. A mounted Practice session never changes source."
>
    <Icon
        name={offlineMode.isLocal ? "download" : "cloud"}
        fontsize={15}
        class="text-muted-foreground transition-colors group-hover:text-foreground"
    />
    <span class="font-medium text-foreground">
        {offlineMode.isLocal ? "Downloaded content" : "Online"}
    </span>
    <input
        class="sr-only"
        type="checkbox"
        checked={offlineMode.downloadedOnly}
        onchange={(event) => (offlineMode.downloadedOnly = event.currentTarget.checked)}
        aria-label="Use downloaded content only"
    />
    <span
        aria-hidden="true"
        class={cn(
            "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out",
            offlineMode.downloadedOnly
                ? "bg-foreground/80 dark:bg-foreground/70"
                : "bg-input/60 group-hover:bg-input"
        )}
    >
        <span
            class={cn(
                "inline-block h-3 w-3 rounded-full bg-surface-container-lowest shadow-xs transition-transform duration-200 ease-in-out",
                offlineMode.downloadedOnly ? "translate-x-3" : "translate-x-0"
            )}
        ></span>
    </span>
</label>
{/if}


