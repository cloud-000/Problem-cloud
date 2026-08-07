<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { Figure } from "$lib/components/figure";
    import {
        parseMathStatement,
        segmentStatement,
    } from "$lib/utils/math-parser";
    import { parseMarkdown } from "$lib/utils/markdown";

    let {
        text = "",
        format = "bbcode",
        class: className = "",
    }: {
        text?: string;
        /**
         * Which dialect `text` is written in. `bbcode` is the authored-statement
         * dialect and the default, so every existing call site is unaffected;
         * `markdown` is model-authored prose, which needs block structure
         * (see `$lib/utils/markdown.ts`).
         */
        format?: "bbcode" | "markdown";
        class?: string;
    } = $props();

    // Split the statement into inline-markup runs (rendered via <LaTeX>) and
    // interactive images (rendered via <Figure>) sitting between them.
    // Index keying + {#if} gives correct lifecycle: editing the text remounts
    // only what changed and disposes anything removed (LaTeX's observer,
    // Figure's lightbox listeners).
    let segments = $derived(
        segmentStatement(format === "markdown" ? parseMarkdown(text) : parseMathStatement(text)),
    );
</script>

<div class={className}>
    {#each segments as segment, i (i)}
        {#if segment.kind === "asy"}
            <Figure imageSrc={segment.imageSrc} code={segment.code} alt="Asymptote diagram" />
        {:else if segment.kind === "img"}
            <Figure imageSrc={segment.src} alt={segment.alt} />
        {:else}
            <!-- `pc-md` styles the block markup only markdown produces. It has to
                 land on LaTeX's render element, because that is the ancestor of
                 the injected HTML in the clone KaTeX actually renders. -->
            <LaTeX class={format === "markdown" ? "pc-md" : ""}>{@html segment.html}</LaTeX>
        {/if}
    {/each}
</div>
