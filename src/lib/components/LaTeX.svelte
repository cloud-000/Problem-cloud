<script lang="ts">
    import { settings } from "$lib/state/settings.svelte";
    import { onMount, type Snippet } from "svelte";

    let {
        class: className = "",
        children,
    }: { class?: string; children?: Snippet } = $props();

    // Svelte renders `children` into `sourceEl` (hidden); KaTeX never touches
    // it, so Svelte's reactive updates there stay intact. We mirror its HTML
    // into the visible `renderEl` and run KaTeX over the clone. Anything inside
    // <LaTeX> is therefore shown as static HTML — interactive Svelte components
    // lose their handlers/bindings in the clone, so put embeds *between* LaTeX
    // instances rather than inside one.
    let sourceEl: HTMLDivElement | null = null;
    let renderEl: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;

    // KaTeX rendering configuration matching the legacy app configuration.
    // Starred environments (e.g. align*) are listed before unstarred ones so
    // auto-render matches the longer delimiter prefix.
    const delimiters = [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
        { left: "\\begin{equation}", right: "\\end{equation}", display: true },
        { left: "\\begin{align*}", right: "\\end{align*}", display: true },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
        { left: "\\begin{alignat*}", right: "\\end{alignat*}", display: true },
        { left: "\\begin{alignat}", right: "\\end{alignat}", display: true },
        { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
        { left: "\\begin{gather}", right: "\\end{gather}", display: true },
        { left: "\\begin{CD}", right: "\\end{CD}", display: true },
    ];

    const macros = {
        "\\sun": "\\odot",
        "\\mbox": "\\text",
        "\\bigskip": "\\space",
    };

    // Rebuild the visible output from the pristine source, then let KaTeX
    // mutate the clone. Rebuilding wholesale each time means there is nothing
    // to duplicate and KaTeX always sees the original $...$ source.
    function syncAndRender() {
        if (typeof window === "undefined" || !sourceEl || !renderEl) return;

        renderEl.innerHTML = sourceEl.innerHTML;

        // Auto-render auto-loaded from window
        const renderMathInElement = (window as any).renderMathInElement;
        if (!renderMathInElement) return;
        try {
            renderMathInElement(renderEl, {
                delimiters,
                macros,
                ignoredClasses: ["katex-ignore"],
            });
        } catch (err) {
            console.error("KaTeX failed to render", err);
        }
    }

    onMount(() => {
        syncAndRender();

        // Observe the source only. It is never KaTeX-mutated, so there is no
        // feedback loop, and any reactive change to `children` triggers a
        // fresh sync + render.
        observer = new MutationObserver(syncAndRender);
        if (sourceEl) {
            observer.observe(sourceEl, {
                childList: true,
                subtree: true,
                characterData: true,
            });
        }

        return () => observer?.disconnect();
    });
</script>

<div bind:this={sourceEl} hidden aria-hidden="true" class="hidden">
    {@render children?.()}
</div>
<div
    bind:this={renderEl}
    class="font-serif leading-relaxed select-text {className}"
    style:font-size={`${settings.readingTextScale}em`}
>{@render children?.()}</div>
