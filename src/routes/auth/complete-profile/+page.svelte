<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import type { ActionData, PageData } from "./$types";

    let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Choose a username — ProblemCloud</title></svelte:head>

<header>
    <h1 class="type-page-title">Choose a username</h1>
    <p class="mt-2 type-secondary text-muted-foreground">One last step before you start practicing.</p>
</header>

<label class="flex flex-col gap-1.5 type-secondary font-medium text-foreground">
    <span>Username</span>
    <Input
        name="username"
        type="text"
        required
        minlength={3}
        value={form?.username ?? ""}
        placeholder="What should we call you?"
        autocomplete="username"
        class="h-11 bg-background"
    />
</label>

{#if form?.message || data.message}
    <p role="alert" class="border-l-2 border-error px-3 py-2 type-secondary text-error">{form?.message ?? data.message}</p>
{/if}

<Button type="submit" size="lg" class="w-full">Continue</Button>
