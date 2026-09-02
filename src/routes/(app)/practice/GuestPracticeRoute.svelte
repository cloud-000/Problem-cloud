<script lang="ts">
    import { createGuestTrainerDataSource } from "$lib/trainer-data-source";
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
    let source = $derived(
        createGuestTrainerDataSource({ supabase: data.supabase, sessionId: sessionId ?? -1 }),
    );
</script>

{#if sessionId != null && Number.isSafeInteger(sessionId) && sessionId > 0}
    <PracticeView {data} sessionParam={`guest:${sessionId}`} trainerSource={source} />
{/if}
