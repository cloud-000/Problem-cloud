<script lang="ts">
    import OfflineShell from "$lib/offline/OfflineShell.svelte";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
</script>

<svelte:head>
    <title>Downloads · ProblemCloud</title>
</svelte:head>

<OfflineShell embedded appSupabase={data.supabase} />
