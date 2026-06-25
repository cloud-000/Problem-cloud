<script lang="ts">
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Select } from "$lib/components/select";
    import {
        fetchByIds,
        LEVELS,
        type Level,
        type ProblemRow,
        type SeriesRow,
        type TestRow,
    } from "$lib/library";
    import FindResults from "./FindResults.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase } = $derived(data);

    // Singular labels — you're finding individual records by id.
    const LEVEL_LABELS: Record<Level, string> = {
        series: "Series",
        tests: "Test",
        problems: "Problem",
    };
    const selectOptions = LEVELS.map((lvl) => ({
        value: lvl,
        label: LEVEL_LABELS[lvl],
    }));

    let level = $state<Level>("problems");
    let idsInput = $state("");

    let results = $state<(SeriesRow | TestRow | ProblemRow)[]>([]);
    let notFound = $state<number[]>([]);
    let resultLevel = $state<Level>("problems"); // level the current results belong to
    let loading = $state(false);
    let errorMsg = $state<string | null>(null);

    /** Parse the textarea/input into a deduped list of positive integer ids. */
    function parseIds(input: string): number[] {
        const ids = input
            .split(/[\s,]+/)
            .map((s) => Number(s))
            .filter((n) => Number.isInteger(n) && n > 0);
        return [...new Set(ids)];
    }

    async function search() {
        const ids = parseIds(idsInput);
        const searchLevel = level;
        if (ids.length === 0) {
            results = [];
            notFound = [];
            errorMsg = null;
            return;
        }
        loading = true;
        try {
            const data = await fetchByIds(supabase, searchLevel, ids);
            results = data;
            resultLevel = searchLevel;
            const found = new Set(data.map((r) => r.id));
            notFound = ids.filter((id) => !found.has(id));
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message;
        } finally {
            loading = false;
        }
    }

    function onkeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            search();
        }
    }
</script>

<div class="flex flex-col gap-4 p-6">
    <div class="flex items-center gap-2">
        <Select
            class="w-32"
            options={selectOptions}
            value={level}
            onchange={(val) => (level = val as Level)}
        />
        <Input
            class="flex-1"
            bind:value={idsInput}
            placeholder="Enter ids, e.g. 1, 2, 3"
            {onkeydown}
        />
        <Button onclick={search} disabled={loading}>
            <Icon name="search" />
            Search
        </Button>
    </div>

    <FindResults
        level={resultLevel}
        {results}
        {loading}
        error={errorMsg}
        {notFound}
    />
</div>
