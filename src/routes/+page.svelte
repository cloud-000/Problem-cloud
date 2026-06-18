<script lang="ts">
    import type { PageData } from "./$types";
    let { data }: { data: PageData } = $props();
    let { supabase, session } = $derived(data);
</script>

{#if session}
    <p>Logged in</p>
{:else}
    <p>Logged out</p>
{/if}
