<script lang="ts">
    import { onMount } from "svelte";
    import { createGuestTrainerDataSource } from "$lib/trainer-data-source";
    import type { TrainerDataSource } from "$lib/trainer-data-source";
    import PracticeView from "./PracticeView.svelte";
    import type { PageData } from "./$types";

    let { data, sessionParam }: { data: PageData; sessionParam: string | null } = $props();
    // Navigation clears the query string before this keyed component is destroyed.
    // Keep that teardown state harmless instead of calling `.slice()` on null.
    let sessionId = $derived(
        sessionParam?.startsWith("guest:")
            ? Number(sessionParam.slice("guest:".length))
            : null,
    );
    let source = $state<TrainerDataSource | null>(null);

    // Guest sessions live in IndexedDB, which only exists in the browser. Defer the
    // data source — and its repository open — until after hydration so SSR can safely
    // render this route.
    onMount(() => {
        if (sessionId == null || !Number.isSafeInteger(sessionId) || sessionId <= 0) return;
        source = createGuestTrainerDataSource({ supabase: data.supabase, sessionId });
    });
</script>

{#if source}
    <PracticeView {data} sessionParam={`guest:${sessionId}`} trainerSource={source} />
{/if}
