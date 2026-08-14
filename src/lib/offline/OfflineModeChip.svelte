<script lang="ts">
    import { onMount } from "svelte";
    import { Icon } from "$lib/components/icon";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

    let {
        showControl = true,
        floating = true,
    }: {
        showControl?: boolean;
        floating?: boolean;
    } = $props();

    onMount(() => {
        const online = () => offlineMode.dispatch({ type: "browser-online" });
        const offline = () => offlineMode.dispatch({ type: "browser-offline" });
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        if (!navigator.onLine) offline();
        return () => {
            window.removeEventListener("online", online);
            window.removeEventListener("offline", offline);
        };
    });
</script>

{#if showControl}
<label
    class={floating
        ? "fixed right-3 top-3 z-[65] inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-container-lowest px-3 py-1.5 type-caption text-foreground shadow-sm"
        : "inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-container-lowest px-3 py-1.5 type-caption text-foreground"}
    title="Use downloaded content for local pages and new Practice launches. A mounted Practice session never changes source."
>
    <Icon name="cloud" fontsize={16} />
    <span>{offlineMode.effective === "local" ? "Downloaded content" : "Online"}</span>
    <input
        class="sr-only"
        type="checkbox"
        checked={offlineMode.preference === "downloaded-only"}
        onchange={(event) => offlineMode.setDownloadedOnly(event.currentTarget.checked)}
        aria-label="Use downloaded content only"
    />
    <span aria-hidden="true" class="h-3.5 w-6 rounded-full bg-surface-container-high p-0.5">
        <span class={offlineMode.preference === "downloaded-only" ? "block h-2.5 w-2.5 translate-x-2.5 rounded-full bg-primary transition-transform" : "block h-2.5 w-2.5 rounded-full bg-muted-foreground transition-transform"}></span>
    </span>
</label>
{/if}
