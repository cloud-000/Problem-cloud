<script lang="ts">
    import { topbar } from "$lib/state/topbar.svelte";
    import type { Snippet } from "svelte";

    let { left, right }: { left?: Snippet; right?: Snippet } = $props();

    $effect(() => {
        topbar.leftSnippet = left ?? null;
        topbar.rightSnippet = right ?? null;
        topbar.visible = true;

        return () => {
            topbar.reset();
        };
    });
</script>
