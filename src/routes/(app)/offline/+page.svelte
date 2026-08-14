<script lang="ts">
    import OfflineShell from "$lib/offline/OfflineShell.svelte";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
</script>

<OfflineShell embedded appSupabase={data.supabase} />
