<script lang="ts">
    import { MathStatement } from "$lib/components/math-statement";
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";
    import {
        DropdownMenu,
        type DropdownOption,
    } from "$lib/components/dropdown-menu";
    import { slide } from "svelte/transition";
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";
    import { partitionProblemSolutions } from "./problem-solutions";

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

    // Video links share the source column with written solutions, but are a
    // separate resource rather than another numbered solution.
    let partitioned = $derived(partitionProblemSolutions(solutions));
    let items = $derived(partitioned.written);
    let videoLinks = $derived(partitioned.videoLinks);
    let count = $derived(items.length);
    let totalCount = $derived(count + videoLinks.length);

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

{#if totalCount > 0}
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
            <span>{totalCount > 1 ? "Solutions" : "Solution"}</span>
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

                {#if count > 0}
                    <MathStatement
                        text={items[selected] ?? ""}
                        class="text-left font-serif text-base leading-relaxed text-foreground md:text-lg"
                    />
                {/if}

                {#if videoLinks.length > 0}
                    <section
                        class={cn(
                            count > 0 && "mt-5 border-t border-border/50 pt-4",
                        )}
                    >
                        <h3 class="text-sm font-semibold text-foreground">
                            {videoLinks.length > 1
                                ? "Video solutions"
                                : "Video solution"}
                        </h3>
                        <ul class="mt-2 flex flex-col gap-1.5">
                            {#each videoLinks as link, i (link)}
                                <li>
                                    <Button
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        variant="outline"
                                        class="group h-auto w-full min-w-0 justify-start gap-3 bg-background px-3 py-2.5 text-left shadow-xs hover:border-foreground/25 hover:bg-surface-container-low hover:text-foreground"
                                    >
                                        <Icon
                                            name="play_circle"
                                            fill
                                            class="shrink-0 text-[1.35em] text-destructive"
                                        />
                                        <span class="flex min-w-0 flex-1 flex-col">
                                            <span class="font-medium text-foreground">
                                                Video solution{videoLinks.length > 1
                                                    ? ` ${i + 1}`
                                                    : ""}
                                            </span>
                                            <span
                                                class="truncate text-xs font-normal text-muted-foreground"
                                            >{link}</span>
                                        </span>
                                        <Icon
                                            name="open_in_new"
                                            class="ml-auto shrink-0 text-[1em] text-foreground/70 transition-colors group-hover:text-foreground"
                                        />
                                    </Button>
                                </li>
                            {/each}
                        </ul>
                    </section>
                {/if}
            </div>
        {/if}
    </div>
{/if}
