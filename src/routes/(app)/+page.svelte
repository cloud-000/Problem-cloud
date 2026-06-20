<script lang="ts">
    import type { PageData } from "./$types";
    let { data }: { data: PageData } = $props();
    let { supabase, session, profile } = $derived(data);
    import { Button } from "$lib/components/button/.";
    import { enhance } from "$app/forms";
    $inspect(profile);
</script>

<h1>Hello {profile?.username}</h1>
{#if session}
    <p>Logged in</p>
    <form action="/auth/logout" method="POST" use:enhance>
        <Button type="submit">Logout</Button>
    </form>
    <p>Hello {profile?.username}</p>
{:else}
    <p>Logged out</p>
    <Button href="/auth/login">Log In</Button>
{/if}
