<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { AsyImage } from "$lib/components/asy-image";
    import {
        parseMathStatement,
        segmentStatement,
    } from "$lib/utils/math-parser";

    let {
        text = "",
        class: className = "",
    }: {
        text?: string;
        class?: string;
    } = $props();

    // Split the statement into inline-markup runs (rendered via <LaTeX>) and
    // interactive asy diagrams (rendered via <AsyImage>) sitting between them.
    // Index keying + {#if} gives correct lifecycle: editing the text remounts
    // only what changed and disposes anything removed (LaTeX's observer,
    // AsyImage's lightbox listeners).
    let segments = $derived(segmentStatement(parseMathStatement(text)));
</script>

<div class={className}>
    {#each segments as segment, i (i)}
        {#if segment.kind === "asy"}
            <AsyImage imageSrc={segment.imageSrc} code={segment.code} />
        {:else}
            <LaTeX>{@html segment.html}</LaTeX>
        {/if}
    {/each}
</div>
