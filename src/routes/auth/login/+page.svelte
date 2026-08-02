<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import type { ActionData } from "./$types";

    let { form }: { form: ActionData } = $props();

    const items = [
        { name: "email", type: "email", label: "Email address", placeholder: "you@example.com", autocomplete: "email" },
        { name: "password", type: "password", label: "Password", placeholder: "Enter your password", autocomplete: "current-password" },
    ] as const;
</script>

<svelte:head><title>Log in — ProblemCloud</title></svelte:head>

<header>
    <h1 class="type-page-title">Log in</h1>
    <p class="mt-2 type-secondary text-muted-foreground">Continue your focused practice and progress.</p>
</header>

<div class="space-y-4">
    {#each items as item (item.name)}
        <label class="flex flex-col gap-1.5 type-secondary font-medium text-foreground">
            <span>{item.label}</span>
            <Input name={item.name} type={item.type} required placeholder={item.placeholder} autocomplete={item.autocomplete} class="h-11 bg-background" />
        </label>
    {/each}
</div>

{#if form?.message}
    <p role="alert" class="border-l-2 border-error px-3 py-2 type-secondary text-error">{form.message}</p>
{/if}

<Button type="submit" size="lg" class="w-full">Log in</Button>

<p class="type-secondary text-muted-foreground">
    Don’t have an account? <a href={resolve("/auth/signup")} class="font-medium text-primary-foreground underline-offset-4 hover:underline">Create account</a>
</p>
