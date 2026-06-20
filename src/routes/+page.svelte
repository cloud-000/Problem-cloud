<script lang="ts">
    import type { PageData } from "./$types";
    let { data }: { data: PageData } = $props();
    let { supabase, session } = $derived(data);
    import { Button } from "$lib/components/button/.";
    import { enhance } from "$app/forms";
</script>

{#if session}
    <p>Logged in</p>
    <form action="/auth/logout" method="POST" use:enhance>
        <Button type="submit">Logout</Button>
    </form>
{:else}
    <p>Logged out</p>
    <Button href="/auth/login">Log In</Button>
{/if}
