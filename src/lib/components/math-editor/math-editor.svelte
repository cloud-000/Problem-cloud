<script lang="ts">
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";
    import InteractiveMathBlock from "./interactive-math-block.svelte";

    let {
        value = $bindable(""),
        class: className = "",
    }: {
        value?: string;
        class?: string;
    } = $props();

    interface TextSegment {
        id: string;
        type: "text";
        value: string;
    }

    interface MathSegment {
        id: string;
        type: "math";
        left: string;
        right: string;
        value: string;
        display: boolean;
    }

    type Segment = TextSegment | MathSegment;

    type DraftSegment =
        | { type: "text"; value: string }
        | { type: "math"; left: string; right: string; value: string; display: boolean };

    let segments = $state<Segment[]>([]);
    let activeFocusId = $state<string | null>(null);
    let activeCursorPos = $state<number | null>(null);

    const MATH_REGEX = /(?<!\\)(\$\$(.*?)(?<!\\)\$\$)|(?<!\\)(\$(.*?)(?<!\\)\$)|(?<!\\)(\\\((.*?)(?<!\\)\\\))|(?<!\\)(\\\[(.*?)(?<!\\)\\\])|(?<!\\)(\\begin\{equation\}([\s\S]*?)(?<!\\)\\end\{equation\})|(?<!\\)(\\begin\{align\}([\s\S]*?)(?<!\\)\\end\{align\})/g;
    const PLACEHOLDER = "\u200b";

    function withoutPlaceholders(text: string) {
        return text.replaceAll(PLACEHOLDER, "");
    }

    function logicalLength(text: string | null | undefined) {
        return withoutPlaceholders(text ?? "").length;
    }

    function parseTextToSegments(text: string): DraftSegment[] {
        const result: DraftSegment[] = [];
        let lastIndex = 0;
        
        MATH_REGEX.lastIndex = 0;
        let match;
        while ((match = MATH_REGEX.exec(text)) !== null) {
            const matchIndex = match.index;
            
            if (matchIndex > lastIndex) {
                result.push({
                    type: "text",
                    value: text.slice(lastIndex, matchIndex)
                });
            }
            
            let left = "";
            let right = "";
            let val = "";
            let display = false;
            
            if (match[1] !== undefined) {
                left = "$$"; right = "$$"; val = match[2]; display = true;
            } else if (match[3] !== undefined) {
                left = "$"; right = "$"; val = match[4]; display = false;
            } else if (match[5] !== undefined) {
                left = "\\("; right = "\\)"; val = match[6]; display = false;
            } else if (match[7] !== undefined) {
                left = "\\["; right = "\\]"; val = match[8]; display = true;
            } else if (match[9] !== undefined) {
                left = "\\begin{equation}"; right = "\\end{equation}"; val = match[10]; display = true;
            } else if (match[11] !== undefined) {
                left = "\\begin{align}"; right = "\\end{align}"; val = match[12]; display = true;
            }
            
            result.push({
                type: "math",
                left,
                right,
                value: val,
                display
            });
            
            lastIndex = MATH_REGEX.lastIndex;
        }
        
        if (lastIndex < text.length) {
            result.push({
                type: "text",
                value: text.slice(lastIndex)
            });
        }
        
        return result;
    }

    function normalizeSegments(segs: Segment[]): Segment[] {
        const result: Segment[] = [];
        for (const seg of segs) {
            if (seg.type === "text") {
                const last = result[result.length - 1];
                if (last && last.type === "text") {
                    last.value += seg.value;
                } else {
                    result.push({ ...seg });
                }
            } else {
                if (result.length === 0 || result[result.length - 1].type !== "text") {
                    result.push({ id: crypto.randomUUID(), type: "text", value: "\u200b" });
                }
                result.push({ ...seg });
            }
        }
        if (result.length === 0 || result[0].type !== "text") {
            result.unshift({ id: crypto.randomUUID(), type: "text", value: "\u200b" });
        }
        if (result[result.length - 1].type !== "text") {
            result.push({ id: crypto.randomUUID(), type: "text", value: "\u200b" });
        }

        // Canonicalize text segments so they are never truly empty in the DOM
        for (const r of result) {
            if (r.type === "text") {
                const clean = r.value.replace(/\u200b/g, "");
                if (clean === "") {
                    r.value = "\u200b";
                } else {
                    r.value = clean;
                }
            }
        }

        return result;
    }

    // Synchronize external value changes to internal segments
    $effect(() => {
        const currentVal = value;

        untrack(() => {
            const currentStr = segments.map(s => {
                if (s.type === "text") return withoutPlaceholders(s.value);
                return s.left + s.value + s.right;
            }).join("");

            if (currentVal !== currentStr) {
                segments = normalizeSegments(
                    parseTextToSegments(currentVal).map(s => {
                        if (s.type === "text") {
                            return { id: crypto.randomUUID(), type: "text", value: s.value };
                        } else {
                            return { id: crypto.randomUUID(), type: "math", left: s.left, right: s.right, value: s.value, display: s.display };
                        }
                    })
                );
            }
        });
    });

    // Synchronize internal segments back to external value reactively
    $effect(() => {
        const str = segments.map(s => {
            if (s.type === "text") return withoutPlaceholders(s.value);
            return s.left + s.value + s.right;
        }).join("");
        
        if (value !== str) {
            value = str;
        }
    });

    function handleTextChange(i: number, node: HTMLElement) {
        const segment = segments[i];
        if (segment.type !== "text") return;

        // Clean any temporary layout-level \u200b before parsing delimiters
        const val = node.innerText;
        const cleanVal = withoutPlaceholders(val);
        segment.value = cleanVal === "" ? "\u200b" : cleanVal;

        const parsed = parseTextToSegments(cleanVal);
        if (parsed.length > 1) {
            const newSegments = parsed.map(p => {
                if (p.type === "text") {
                    return { id: crypto.randomUUID(), type: "text", value: p.value } as Segment;
                } else {
                    return { id: crypto.randomUUID(), type: "math", left: p.left, right: p.right, value: p.value, display: p.display } as Segment;
                }
            });

            const lastMathIndex = newSegments.findLastIndex(s => s.type === "math");
            const focusMathId = newSegments[lastMathIndex]?.id;

            segments.splice(i, 1, ...newSegments);
            segments = normalizeSegments(segments);

            const normalizedMathIndex = segments.findIndex((s) => s.id === focusMathId);
            const focusSegment = normalizedMathIndex >= 0 ? segments[normalizedMathIndex + 1] : null;

            if (focusSegment?.type === "text") {
                activeFocusId = focusSegment.id;
                activeCursorPos = 0;
            }
        }
    }

    function isSelectionCollapsedInside(node: HTMLElement) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return true;

        const range = selection.getRangeAt(0);
        return range.collapsed && node.contains(range.startContainer);
    }

    function getCaretPosition(node: HTMLElement): number {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return 0;
        const range = selection.getRangeAt(0);
        
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(node);
        preCaretRange.setEnd(range.startContainer, range.startOffset);
        
        return logicalLength(preCaretRange.toString());
    }

    function rawOffsetForLogicalPosition(text: string, pos: number) {
        if (pos <= 0) {
            const firstRealChar = [...text].findIndex((char) => char !== PLACEHOLDER);
            return firstRealChar === -1 ? text.length : firstRealChar;
        }

        let seen = 0;
        for (let offset = 0; offset < text.length; offset += 1) {
            if (text[offset] === PLACEHOLDER) continue;

            seen += 1;
            if (seen === pos) {
                return offset + 1;
            }
        }

        return text.length;
    }

    function setCaretPosition(node: HTMLElement, pos: number) {
        node.focus();
        const selection = window.getSelection();
        if (!selection) return;

        const range = document.createRange();

        const targetPos = Math.max(0, Math.min(logicalLength(node.textContent), pos));
        let remaining = targetPos;
        let fallback: Text | null = null;

        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode() as Text | null;

        while (textNode) {
            const text = textNode.textContent ?? "";
            const textLogicalLength = logicalLength(text);
            fallback = textNode;

            if (remaining <= textLogicalLength) {
                range.setStart(textNode, rawOffsetForLogicalPosition(text, remaining));
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }

            remaining -= textLogicalLength;
            textNode = walker.nextNode() as Text | null;
        }

        if (!fallback) {
            fallback = document.createTextNode(PLACEHOLDER);
            node.appendChild(fallback);
        }

        try {
            range.setStart(fallback, fallback.textContent?.length ?? 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (err) {
            console.warn("Failed to set selection", err);
        }
    }

    function handleTextKeyDown(e: KeyboardEvent, i: number) {
        const node = e.currentTarget as HTMLElement;
        const caretPos = getCaretPosition(node);
        const textLen = logicalLength(node.textContent);
        const isCollapsed = isSelectionCollapsedInside(node);

        if (e.key === "Enter") {
            e.preventDefault();
            // Clean insert of a newline using modern browser commands
            document.execCommand("insertText", false, "\n");
            handleTextChange(i, node);
        } else if (e.key === "Backspace") {
            if (isCollapsed && caretPos === 0) {
                if (i > 0) {
                    e.preventDefault();
                    const prevMath = segments[i - 1];
                    if (prevMath.type === "math") {
                        activeFocusId = prevMath.id;
                        activeCursorPos = prevMath.value.length;
                    }
                }
            }
        } else if (e.key === "Delete") {
            if (isCollapsed && caretPos === textLen) {
                if (i < segments.length - 1) {
                    e.preventDefault();
                    const nextMath = segments[i + 1];
                    if (nextMath.type === "math") {
                        activeFocusId = nextMath.id;
                        activeCursorPos = 0;
                    }
                }
            }
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            if (isCollapsed && caretPos === 0) {
                if (i > 0) {
                    e.preventDefault();
                    const prevMath = segments[i - 1];
                    if (prevMath.type === "math") {
                        activeFocusId = prevMath.id;
                        activeCursorPos = prevMath.value.length;
                    }
                }
            }
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            if (isCollapsed && caretPos === textLen) {
                if (i < segments.length - 1) {
                    e.preventDefault();
                    const nextMath = segments[i + 1];
                    if (nextMath.type === "math") {
                        activeFocusId = nextMath.id;
                        activeCursorPos = 0;
                    }
                }
            }
        }
    }

    function handleMathDelete(index: number, direction: "forward" | "backward") {
        const prevSeg = segments[index - 1];
        const nextSeg = segments[index + 1];
        
        let targetId = null;
        let targetPos = 0;
        
        if (prevSeg && prevSeg.type === "text") {
            targetId = prevSeg.id;
            targetPos = logicalLength(prevSeg.value);
        } else if (nextSeg && nextSeg.type === "text") {
            targetId = nextSeg.id;
            targetPos = 0;
        }
        
        segments.splice(index, 1);
        segments = normalizeSegments(segments);
        
        if (targetId) {
            activeFocusId = targetId;
            activeCursorPos = targetPos;
        }
    }

    function handleMathNavigate(index: number, direction: "left" | "right") {
        if (direction === "left") {
            const prevText = segments[index - 1];
            if (prevText && prevText.type === "text") {
                activeFocusId = prevText.id;
                activeCursorPos = logicalLength(prevText.value);
            }
        } else {
            const nextText = segments[index + 1];
            if (nextText && nextText.type === "text") {
                activeFocusId = nextText.id;
                activeCursorPos = 0;
            }
        }
    }

    // Dynamic focus target helper for container click
    function handleContainerClick(e: MouseEvent) {
        if (e.target === e.currentTarget) {
            const lastTextSeg = segments.findLast(s => s.type === "text");
            if (lastTextSeg) {
                activeFocusId = lastTextSeg.id;
                activeCursorPos = logicalLength(lastTextSeg.value);
            }
        }
    }

    // Action to handle focus and cursor position inside text segments
    function focusControl(node: HTMLElement, params: { segmentId: string; focusId: string | null; cursorPos: number | null }) {
        if (params.focusId === params.segmentId) {
            if (params.cursorPos !== null) {
                setCaretPosition(node, params.cursorPos);
                activeCursorPos = null;
            } else {
                node.focus();
            }
        }
        return {
            update(newParams: { segmentId: string; focusId: string | null; cursorPos: number | null }) {
                if (newParams.focusId === newParams.segmentId) {
                    if (newParams.cursorPos !== null) {
                        setCaretPosition(node, newParams.cursorPos);
                        activeCursorPos = null;
                    } else {
                        node.focus();
                    }
                }
            }
        };
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    onclick={handleContainerClick}
    class={cn(
        "w-full rounded-lg border border-input p-3 bg-surface-container-low/30 text-foreground focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent transition-all font-serif text-base leading-relaxed cursor-text min-h-[120px] whitespace-pre-wrap break-words block",
        className
    )}
>
    {#each segments as segment, i (segment.id)}
        {#if segment.type === "text"}
            <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
            <span
                use:focusControl={{ segmentId: segment.id, focusId: activeFocusId, cursorPos: activeCursorPos }}
                contenteditable="true"
                role="textbox"
                tabindex="0"
                bind:innerText={segment.value}
                oninput={(e) => handleTextChange(i, e.currentTarget)}
                onkeydown={(e) => handleTextKeyDown(e, i)}
                onfocus={() => activeFocusId = segment.id}
                class="outline-none focus:outline-none p-0 m-0 text-foreground whitespace-pre-wrap inline"
            ></span>
        {:else}
            <InteractiveMathBlock
                id={segment.id}
                left={segment.left}
                right={segment.right}
                display={segment.display}
                bind:value={segment.value}
                bind:activeFocusId={activeFocusId}
                bind:activeCursorPos={activeCursorPos}
                ondelete={(direction) => handleMathDelete(i, direction)}
                onnavigate={(direction) => handleMathNavigate(i, direction)}
            />
        {/if}
    {/each}
</div>
