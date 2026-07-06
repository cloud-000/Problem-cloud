<script lang="ts">
    import { MathEditor } from "$lib/components/math-editor";
    import { Icon } from "$lib/components/icon";

    // Playground state initialized with some text and delimiters
    let text = $state(
        "Let's define a quadratic function $f(x) = ax^2 + bx + c$ with $a \\neq 0$. " +
        "We can also display math in centering delimiters: $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$ " +
        "and using LaTeX brackets \\( \\sin^2 \\theta + \\cos^2 \\theta = 1 \\) or \\[\n\\int_0^1 x^n dx = \\frac{1}{n+1}\n\\] " +
        "as well as environments:\n\\begin{equation}\ne^{i\\pi} + 1 = 0\n\\end{equation}"
    );
</script>

<div class="space-y-8">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-2">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon name="edit" fontsize="2rem" class="text-primary-foreground" />
            Math Editor Feature Test
        </h1>
        <p class="text-sm text-muted-foreground">
            Testing the live interactive inline math editor, segment splits, key navigations, deletions, and floating previews.
        </p>
    </div>

    <!-- Live Playground -->
    <div
        class="max-w-3xl mx-auto bg-surface-container-lowest border border-border/80 rounded-xl p-5 shadow-xs"
    >
        <!-- Editor -->
        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Interactive Inline Math Editor (Click math to edit with real-time floating preview)
            </span>
            <MathEditor bind:value={text} class="min-h-[250px]" />
            
            <div class="mt-4 space-y-1">
                <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Synced Raw Value (Text String representation)
                </span>
                <pre class="w-full text-xs font-mono bg-surface-container-low/40 border border-border p-3 rounded-lg text-muted-foreground overflow-x-auto whitespace-pre-wrap select-text">{text}</pre>
            </div>
        </div>
    </div>

    <!-- Features list -->
    <div class="max-w-3xl mx-auto border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4">
        <h2 class="text-lg font-semibold text-foreground">Interactive Math Editor Features Checklist</h2>
        <ul class="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
            <li>
                <strong class="text-foreground">Finished Delimiter Auto-conversion</strong>: Type a math equation enclosed in delimiters (e.g. <code>$x^2$</code>, <code>$$y=mx$$</code>, or <code>\(a^2\)</code>) in any text input. As soon as you type the closing delimiter, it turns into an interactive block!
            </li>
            <li>
                <strong class="text-foreground">Editing and Viewing Modes</strong>: Click any math block (rendered via KaTeX) to toggle into edit mode. The delimiters (like <code>$</code>) will be locked on the outside as non-editable labels, and a text input in the center lets you modify the formula. Press <code>Enter</code> or click out to return to view mode.
            </li>
            <li>
                <strong class="text-foreground">Real-time Floating Preview</strong>: When you are editing an equation, a beautiful popover floats above the block, rendering the LaTeX dynamically in real time as you type.
            </li>
            <li>
                <strong class="text-foreground">Seamless Navigation</strong>: Use <code>ArrowLeft</code> and <code>ArrowRight</code> inside the text inputs and math blocks. Caret focus will automatically move across boundaries between text sections and math blocks.
            </li>
            <li>
                <strong class="text-foreground">Natural Deletion</strong>: If you press <code>Backspace</code> at the start of a text span (or <code>Delete</code> at the end), focus jumps to the adjacent math block. Backspacing an empty math block deletes it entirely and merges the surrounding text.
            </li>
        </ul>
    </div>
</div>
