<script lang="ts">
    import { onMount, type Snippet } from "svelte";

    /*interface Props {
        class?: string;
        text: string
    }*/

    let {
        class: className = "",
        children,
    }: { class?: string; children: Snippet } = $props();
    let containerEl: HTMLDivElement | null = null;

    // KaTeX rendering configuration matching the legacy app configuration
    const delimiters = [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\begin{equation}", right: "\\end{equation}", display: true },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
    ];

    const macros = {
        "\\sun": "\\odot",
        "\\mbox": "\\text",
    };

    function renderMath() {
        if (typeof window === "undefined" || !containerEl) return;

        // Auto-render auto-loaded from window
        const renderMathInElement = (window as any).renderMathInElement;
        if (renderMathInElement) {
            try {
                /*katex.render(text, containerEl, {
                    throwOnError: false,
                    macros,
                });*/
                renderMathInElement(containerEl, {
                    delimiters,
                    macros,
                });
            } catch (err) {
                console.error("KaTeX failed to render", err);
            }
        }
    }

    // Trigger rendering when text changes
    $effect(() => {
        // Set up the observer to listen to children modifications
        const observer = new MutationObserver((mutations) => {
            console.log("Children DOM changed!", mutations);
            // Trigger your updates or functions here
        });

        observer.observe(containerEl as Node, {
            childList: true, // Detect additions/removals
            subtree: true, // Detect changes inside grandchildren
            characterData: true, // Detect text changes
        });

        // Cleanup the observer when the component unmounts
        return () => observer.disconnect();
    });

    onMount(() => {
        renderMath();
    });
</script>

<div
    bind:this={containerEl}
    class="font-serif leading-relaxed select-text {className}"
>
    {@render children?.()}
</div>
