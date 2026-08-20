<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Combobox, type Option } from "$lib/components/combobox";
    import { toasts } from "$lib/state/toast.svelte";
    import { updateFocusedSeries, MAX_FOCUSED_SERIES } from "$lib/profile";
    import { fetchAllSeries } from "$lib/library";

    type Supabase = SupabaseClient<Database>;

    let {
        supabase,
        userId,
        focusedSeriesIds = $bindable(),
        seriesNames,
    }: {
        supabase: Supabase;
        userId: string;
        /** Owned by the parent so its stat tiles/worklist react to changes here. */
        focusedSeriesIds: number[];
        /** Series id -> name, so read-only chips don't need their own fetch. */
        seriesNames: Map<number, string>;
    } = $props();

    // Start in edit mode immediately when there's nothing to show as a chip yet.
    let editing = $state(focusedSeriesIds.length === 0);
    let selected = $state<string[]>(focusedSeriesIds.map(String));
    let seriesOptions = $state<Option[]>([]);
    let optionsLoaded = false;
    let container = $state<HTMLDivElement | null>(null);
    // The last value actually written to the DB (or attempted), so stopEditing
    // can skip a no-op write and a failed write knows what to roll back to.
    let persisted = focusedSeriesIds;
    // Writes are chained through this promise so concurrent edits can never
    // land out of order in the DB — without it, firing a write per pick let a
    // later, larger selection's write resolve before an earlier, smaller one's,
    // leaving the DB reflecting whichever request happened to finish last.
    let writeChain: Promise<void> = Promise.resolve();

    async function ensureOptions() {
        if (optionsLoaded) return;
        optionsLoaded = true;
        try {
            const rows = await fetchAllSeries(supabase);
            seriesOptions = rows.map((row) => ({
                value: String(row.id),
                label: row.name,
            }));
        } catch (e) {
            optionsLoaded = false; // allow retry on the next open
            toasts.error((e as Error).message || "Failed to load series.");
        }
    }

    function startEditing() {
        selected = focusedSeriesIds.map(String);
        editing = true;
    }

    // Covers both `startEditing()` and the initial editing=true state (zero
    // focused series yet) — the latter never calls startEditing(), so without
    // this the dropdown would open with no options to pick from.
    $effect(() => {
        if (editing) void ensureOptions();
    });

    // Live local preview only, as the user picks/removes options mid-edit —
    // instant feedback for the stats/worklist below. No network call here; the
    // actual write happens once, in stopEditing().
    function previewSelection(values: string[]) {
        focusedSeriesIds = values.map(Number);
    }

    function persist(next: number[]) {
        const before = persisted;
        writeChain = writeChain.then(async () => {
            try {
                await updateFocusedSeries(supabase, userId, next);
                persisted = next;
            } catch (e) {
                // Only roll back if nothing newer has already superseded this
                // attempt (possible when persist() is called again — e.g. a
                // quick chip removal — before this one's write resolves).
                if (persisted === before) {
                    focusedSeriesIds = before;
                    selected = before.map(String);
                    persisted = before;
                }
                toasts.error(
                    (e as Error).message || "Failed to update focused series.",
                );
            }
        });
    }

    function stopEditing() {
        if (!editing) return;
        editing = false;
        const next = selected.map(Number);
        const unchanged =
            next.length === persisted.length &&
            next.every((id, i) => id === persisted[i]);
        if (!unchanged) persist(next);
    }

    function removeSeries(id: number) {
        const next = focusedSeriesIds.filter((existing) => existing !== id);
        focusedSeriesIds = next;
        selected = next.map(String);
        persist(next);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (editing && event.key === "Escape") {
            event.preventDefault();
            stopEditing();
        }
    }

    function handleFocusOut(event: FocusEvent) {
        const next = event.relatedTarget as Node | null;
        if (container && next && container.contains(next)) return;
        // Defer so a mobile tap on a combobox option can commit before we tear
        // down edit mode. Touch often reports relatedTarget as null when the
        // option is not focusable, which previously exited edit mid-tap.
        setTimeout(() => {
            if (container && !container.contains(document.activeElement)) {
                stopEditing();
            }
        }, 50);
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if editing}
    <div
        bind:this={container}
        role="group"
        aria-label="Focused series editor"
        onfocusout={handleFocusOut}
    >
        <Combobox
            options={seriesOptions}
            strict
            max={MAX_FOCUSED_SERIES}
            bind:value={selected}
            placeholder="Focus a series"
            onchange={previewSelection}
        />
    </div>
{:else}
    <div class="flex flex-wrap items-center gap-1.5">
        {#each focusedSeriesIds as id (id)}
            <span
                class="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 type-caption text-foreground"
            >
                {seriesNames.get(id) ?? `Series ${id}`}
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Stop focusing ${seriesNames.get(id) ?? "this series"}`}
                    onclick={() => removeSeries(id)}
                >
                    <Icon name="close" />
                </Button>
            </span>
        {/each}
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label={focusedSeriesIds.length >= MAX_FOCUSED_SERIES
                ? "Edit focused series"
                : "Focus a series"}
            onclick={startEditing}
        >
            <Icon name="add" />
        </Button>
    </div>
{/if}
