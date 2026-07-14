<script lang="ts">
    import { MathStatement } from "$lib/components/math-statement";
    import { Icon } from "$lib/components/icon";
    import {
        DropdownMenu,
        type DropdownOption,
    } from "$lib/components/dropdown-menu";
    import { slide } from "svelte/transition";
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";

    type Props = {
        /** The problem's `official_solutions`; the panel self-hides when empty. */
        solutions?: string[] | null;
        /**
         * Initial expanded state. Pass `true` on an incorrect answer so the work
         * is shown immediately; correct/ungraded outcomes leave it collapsed.
         * Read once at mount — callers key the panel per problem so it re-seeds.
         */
        defaultOpen?: boolean;
        class?: string;
    };

    let {
        solutions = null,
        defaultOpen = false,
        class: className,
    }: Props = $props();

    // Blank entries are dropped; a problem with no real solutions renders nothing.
    let items = $derived((solutions ?? []).filter((s) => s?.trim()));
    let count = $derived(items.length);

    // One-time seed: the panel mounts fresh per problem (callers key it), so the
    // initial-value read is deliberate, not a stale-closure bug.
    let expanded = $state(untrack(() => defaultOpen));
    let selected = $state(0);

    // Above this count the numbered pills would crowd the header, so the switcher
    // collapses to a compact dropdown instead.
    const PILL_LIMIT = 4;
    let useDropdown = $derived(count > PILL_LIMIT);

    const toggleIconCls =
        "shrink-0 !text-[1em] leading-none transition-transform duration-200";

    let dropdownOptions = $derived<DropdownOption[]>(
        items.map((_, i) => ({
            label: `Solution ${i + 1}`,
            icon: i === selected ? "check" : null,
            onclick: () => (selected = i),
        })),
    );
</script>

{#if count > 0}
    <div class={cn("mx-auto w-full max-w-4xl", className)}>
        <button
            type="button"
            class="flex w-full items-center gap-1.5 border-t border-border/50 pt-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={expanded}
            onclick={() => (expanded = !expanded)}
        >
            <Icon
                name="expand_more"
                opticalSize={20}
                class={cn(toggleIconCls, expanded && "rotate-180")}
            />
            <span>{count > 1 ? "Solutions" : "Solution"}</span>
        </button>

        {#if expanded}
            <div transition:slide={{ duration: 180 }} class="pt-2">
                {#if count > 1}
                    <div class="mb-2 flex items-center gap-1">
                        {#if useDropdown}
                            <DropdownMenu options={dropdownOptions}>
                                <span
                                    class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-surface-container-low px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-container"
                                >
                                    Solution {selected + 1}
                                    <Icon
                                        name="expand_more"
                                        class="size-[1.05em] text-muted-foreground"
                                    />
                                </span>
                            </DropdownMenu>
                        {:else}
                            {#each items as _, i (i)}
                                <button
                                    type="button"
                                    onclick={() => (selected = i)}
                                    aria-label={`Solution ${i + 1}`}
                                    aria-pressed={selected === i}
                                    class={cn(
                                        "size-7 rounded-md text-xs font-semibold tabular-nums transition-colors",
                                        selected === i
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                >
                                    {i + 1}
                                </button>
                            {/each}
                        {/if}
                    </div>
                {/if}

                <MathStatement
                    text={items[selected] ?? ""}
                    class="text-left font-serif text-base leading-relaxed text-foreground md:text-lg"
                />
            </div>
        {/if}
    </div>
{/if}
