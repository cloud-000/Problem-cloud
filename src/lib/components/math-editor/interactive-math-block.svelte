<script lang="ts">
    import LaTeX from "$lib/components/LaTeX.svelte";
    import { cn } from "$lib/utils";

    let {
        id,
        left,
        right,
        value = $bindable(),
        display = false,
        activeFocusId = $bindable(),
        activeCursorPos = $bindable(null),
        ondelete,
        onnavigate,
    }: {
        id: string;
        left: string;
        right: string;
        value: string;
        display?: boolean;
        activeFocusId: string | null;
        activeCursorPos: number | null;
        ondelete?: (direction: "forward" | "backward") => void;
        onnavigate?: (direction: "left" | "right") => void;
    } = $props();

    // Mode is derived directly from whether this block's id is the activeFocusId
    let mode = $derived(activeFocusId === id ? "edit" : "view");

    // Svelte action to handle focus and caret placement when input is rendered/mounted
    function focusInput(node: HTMLTextAreaElement, cursorPos: number | null) {
        node.focus();
        if (cursorPos !== null) {
            const pos = Math.max(0, Math.min(value.length, cursorPos));
            node.setSelectionRange(pos, pos);
            activeCursorPos = null;
        }
        return {
            update(newPos: number | null) {
                if (newPos !== null) {
                    node.focus();
                    const pos = Math.max(0, Math.min(value.length, newPos));
                    node.setSelectionRange(pos, pos);
                    activeCursorPos = null;
                }
            }
        };
    }

    // Redirect focus to the next text segment upon keyboard finish
    function exitEdit(focusNext = false) {
        if (activeFocusId === id) {
            if (focusNext) {
                onnavigate?.("right");
            } else {
                activeFocusId = null;
            }
        }
        if (!value.trim()) {
            ondelete?.("backward");
        }
    }

    function handleFocusOut() {
        exitEdit(false);
    }

    function handleKeyDown(e: KeyboardEvent, node: HTMLTextAreaElement) {
        const isCollapsed = node.selectionStart === node.selectionEnd;

        if (e.key === "Enter") {
            if (display) {
                // In display (multiline) mode, normal Enter inserts a newline, 
                // while Ctrl+Enter or Cmd+Enter finishes the edit.
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    exitEdit(true);
                }
            } else {
                // In inline mode, Enter finishes the edit
                e.preventDefault();
                exitEdit(true);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            exitEdit(true);
        } else if (e.key === "Backspace") {
            if (value.length === 0) {
                e.preventDefault();
                ondelete?.("backward");
            }
        } else if (e.key === "Delete") {
            if (value.length === 0) {
                e.preventDefault();
                ondelete?.("forward");
            }
        } else if (e.key === "ArrowLeft") {
            if (isCollapsed && node.selectionStart === 0) {
                e.preventDefault();
                onnavigate?.("left");
            }
        } else if (e.key === "ArrowRight") {
            if (isCollapsed && node.selectionEnd === value.length) {
                e.preventDefault();
                onnavigate?.("right");
            }
        }
    }

    function startEdit() {
        activeCursorPos = value.length;
        activeFocusId = id;
    }

    function handleViewKeyDown(e: KeyboardEvent) {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            startEdit();
        } else if (e.key === "Backspace") {
            e.preventDefault();
            ondelete?.("backward");
        } else if (e.key === "Delete") {
            e.preventDefault();
            ondelete?.("forward");
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            onnavigate?.("left");
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onnavigate?.("right");
        }
    }
</script>

{#if mode === "view"}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
        role="button"
        tabindex="0"
        onclick={startEdit}
        onkeydown={handleViewKeyDown}
        class={display
            ? "flex justify-center relative w-full my-3 py-2 px-3 rounded cursor-pointer border border-dashed border-transparent hover:bg-primary/5 hover:border-primary/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:border-primary min-h-9"
            : "inline-flex items-center align-middle mx-0.5 px-0.5 py-0 rounded cursor-pointer border border-dashed border-transparent hover:bg-primary/5 hover:border-primary/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:border-primary"}
        title="Click or press Enter to edit math"
    >
        <LaTeX class="pointer-events-none w-full">{left}{value}{right}</LaTeX>
    </span>
{:else}
    {#if display}
        <span class="flex flex-col items-center relative w-full my-3 py-2 px-3 rounded bg-surface-container-low border border-primary/50 ring-1 ring-primary/30 min-h-9 gap-1.5">
            <!-- Floating live rendered preview popover -->
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-50 pointer-events-none select-none">
                <div class="relative bg-surface-container-lowest border border-border rounded-lg shadow-lg p-2.5 min-h-8 min-w-[70px] flex items-center justify-center">
                    <LaTeX class="text-center">{left}{value}{right}</LaTeX>
                    <!-- Small pointer arrow -->
                    <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1.5 w-3 h-3 bg-surface-container-lowest border-r border-b border-border rotate-45"></div>
                </div>
            </div>

            <span class="select-none text-muted-foreground/80 font-mono text-[11px] self-start">{left}</span>
            
            <span class="inline-grid items-center relative w-full" style="grid-template-columns: minmax(1ch, 100%);">
                <span class="invisible whitespace-pre-wrap col-start-1 row-start-1 pointer-events-none font-mono text-sm px-0.5 w-full break-all">
                    {(value || "") + "\u200b"}
                </span>
                <textarea
                    use:focusInput={activeCursorPos}
                    bind:value
                    cols="1"
                    rows="1"
                    onkeydown={(e) => handleKeyDown(e, e.currentTarget)}
                    onblur={handleFocusOut}
                    class="col-start-1 row-start-1 w-full h-full min-w-0 bg-transparent border-none outline-none focus:outline-none p-0 m-0 font-mono text-sm px-0.5 text-foreground resize-none overflow-hidden text-center"
                ></textarea>
            </span>

            <span class="select-none text-muted-foreground/80 font-mono text-[11px] self-end">{right}</span>
        </span>
    {:else}
        <span class="inline-flex items-center align-middle relative mx-0.5 px-1 py-0 rounded bg-surface-container-low border border-primary/50 ring-1 ring-primary/30">
            <!-- Floating live rendered preview popover -->
            <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-50 pointer-events-none select-none">
                <div class="relative bg-surface-container-lowest border border-border rounded-lg shadow-lg p-2 min-h-7 min-w-[60px] flex items-center justify-center">
                    <LaTeX>{left}{value}{right}</LaTeX>
                    <!-- Small pointer arrow -->
                    <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-1.5 w-2.5 h-2.5 bg-surface-container-lowest border-r border-b border-border rotate-45"></div>
                </div>
            </div>

            <span class="select-none text-muted-foreground/80 font-mono text-[11px] mr-1">{left}</span>
            
            <span class="inline-grid items-center relative" style="grid-template-columns: minmax(1ch, max-content); min-width: 1ch;">
                <span class="invisible whitespace-pre-wrap col-start-1 row-start-1 pointer-events-none font-mono text-sm px-0.5">
                    {(value || "") + "\u200b"}
                </span>
                <textarea
                    use:focusInput={activeCursorPos}
                    bind:value
                    cols="1"
                    rows="1"
                    onkeydown={(e) => handleKeyDown(e, e.currentTarget)}
                    onblur={handleFocusOut}
                    class="col-start-1 row-start-1 w-full h-full min-w-0 bg-transparent border-none outline-none focus:outline-none p-0 m-0 font-mono text-sm px-0.5 text-foreground resize-none overflow-hidden"
                ></textarea>
            </span>

            <span class="select-none text-muted-foreground/80 font-mono text-[11px] ml-1">{right}</span>
        </span>
    {/if}
{/if}
