<script lang="ts">
    import { MathStatement } from "$lib/components/math-statement";
    import { Button } from "$lib/components/button";
    import { toasts } from "$lib/state/toast.svelte";
    import { Icon } from "$lib/components/icon";

    // Playground state
    let playgroundText = $state(
        `Hello. \n\n` +
            `$f(x) = x^2 + ax + b$ and $$\\frac{f(f(x) + x)}{f(x)} = x^2 + 1776x + 2010$$` +
            `Find $f(x)$` +
            `Fake solve it. [url=http://52.40.178.25]Mandelbrot Website[/url]` +
            `Also test image` +
            `[asy=https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Unit_circle.svg/960px-Unit_circle.svg.png]\n` +
            `size(150);\n` +
            `draw(unitcircle, blue);\n` +
            `draw((-1.2,0)--(1.2,0), arrow=Arrow);\n` +
            `draw((0,-1.2)--(0,1.2), arrow=Arrow);\n` +
            `label("$x$", (1.2,0), E);\n` +
            `label("$y$", (0,1.2), N);\n` +
            `[/asy]\n`,
    );

    function triggerTestToasts() {
        toasts.success("Toasts system is working!");
    }
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div
        class="flex flex-col md:flex-row md:items-center md:justify-between border-b border-border/80 pb-4 gap-4"
    >
        <div>
            <h1
                class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
            >
                <Icon name="calculate" class="text-primary-foreground size-8" />
                Math Statement Feature Test
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
                Testing live BBCode + LaTeX + Asymptote parsing and rendering.
            </p>
        </div>
        <Button variant="outline" size="sm" onclick={triggerTestToasts}>
            <Icon name="notifications" class="size-4 mr-1.5" />
            Test Toast
        </Button>
    </div>

    <!-- Live Playground -->
    <div
        class="grid grid-cols-1 md:grid-cols-2 gap-6 bg-surface-container-lowest border border-border/80 rounded-xl p-5 shadow-xs"
    >
        <!-- Editor Left -->
        <div class="flex flex-col gap-2">
            <label
                for="editor"
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Editor (Playground)
            </label>
            <textarea
                id="editor"
                bind:value={playgroundText}
                rows="14"
                class="w-full rounded-lg border border-input p-3 font-mono text-sm bg-surface-container-low/30 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-transparent transition-all"
                placeholder="Type some text with BBCode, LaTeX ($x^2$), and [asy=link]code[/asy]..."
            ></textarea>
        </div>

        <!-- Rendered Right -->
        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Live Rendered Output
            </span>
            <div
                class="flex-1 rounded-lg border border-border bg-surface-container-low/20 p-4 overflow-y-auto select-text"
            >
                <MathStatement text={playgroundText} />
            </div>
        </div>
    </div>

    <!-- Static Test Suite -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4"
    >
        <h2 class="text-lg font-semibold text-foreground">
            Static BBCode Syntax Test Suite
        </h2>
        <div class="space-y-3">
            <!-- Bold & Italic -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-center"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[b]bold[/b] and [i]italics[/i]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text="This is [b]bold text[/b] and this is [i]italicized text[/i]."
                    />
                </span>
            </div>

            <!-- Nested tags -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-center"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[b]bold with [i]italic[/i][/b]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text="Here is [b]bold with [i]italic inside bold[/i] and [u]underline inside bold[/u][/b] text."
                    />
                </span>
            </div>

            <!-- Underline & Strikethrough -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-center"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[u]underline[/u] and [s]strikethrough[/s]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text="Please [u]underline this[/u] and [s]strike through this[/s] word."
                    />
                </span>
            </div>

            <!-- Link -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-center"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[url=...]link[/url]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text="Visit the [url=https://github.com]GitHub homepage[/url] or check [url]https://google.com[/url]."
                    />
                </span>
            </div>

            <!-- Code -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-center"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[code]monospaced[/code]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text="Run [code]npm install svelte[/code] to install Svelte, where [b]tags inside [code][b]are ignored[/b][/code][/b]."
                    />
                </span>
            </div>

            <!-- Asymptote verbatim -->
            <div
                class="grid grid-cols-3 py-2 border-b border-border/40 gap-4 items-start"
            >
                <span class="text-xs font-mono text-muted-foreground"
                    >[asy]asymptote[/asy]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text={"This is an asymptote tag without a diagram URL:\n[asy]\nimport graph;\nsize(100);\nreal f(real x) { return sin(x); }\ndraw(graph(f, 0, 2*pi), red);\n[/asy]\nIt is rendered as a static code block."}
                    />
                </span>
            </div>

            <!-- Static image -->
            <div class="grid grid-cols-3 py-2 gap-4 items-start">
                <span class="text-xs font-mono text-muted-foreground"
                    >[img=label]url[/img]</span
                >
                <span class="col-span-2 text-sm">
                    <MathStatement
                        text={"A plain static image:\n[img=Unit circle]https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Unit_circle.svg/960px-Unit_circle.svg.png[/img]"}
                    />
                </span>
            </div>
        </div>
    </div>
</div>
