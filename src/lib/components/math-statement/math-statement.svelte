<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Figure } from "$lib/components/figure";
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
    // interactive images (rendered via <Figure>) sitting between them.
    // Index keying + {#if} gives correct lifecycle: editing the text remounts
    // only what changed and disposes anything removed (LaTeX's observer,
    // Figure's lightbox listeners).
    let segments = $derived(segmentStatement(parseMathStatement(text)));
</script>

<div class={className}>
    {#each segments as segment, i (i)}
        {#if segment.kind === "asy"}
            <Figure imageSrc={segment.imageSrc} code={segment.code} alt="Asymptote diagram" />
        {:else if segment.kind === "img"}
            <Figure imageSrc={segment.src} alt={segment.alt} autoInvert={false} />
        {:else}
            <LaTeX>{@html segment.html}</LaTeX>
        {/if}
    {/each}
</div>
