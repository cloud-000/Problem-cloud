<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import type { ActionData } from "./$types";

    let { form }: { form: ActionData } = $props();

    const items = [
        { name: "email", type: "email", label: "Email address", placeholder: "you@example.com", autocomplete: "email" },
        { name: "username", type: "text", label: "Username", placeholder: "What should we call you?", autocomplete: "username" },
        { name: "password", type: "password", label: "Password", placeholder: "Create a secure password", autocomplete: "new-password" },
    ] as const;
</script>

<svelte:head><title>Create account — ProblemCloud</title></svelte:head>

{#if form?.confirmationRequired}
    <section aria-labelledby="confirmation-title" class="space-y-5">
        <Icon name="mark_email_unread" class="text-primary-foreground" fontsize={28} weight={500} aria-hidden="true" />
        <div>
            <h1 id="confirmation-title" class="type-page-title">Check your email</h1>
            <p class="mt-2 type-secondary text-muted-foreground">
                We sent a confirmation link to <strong class="font-medium text-foreground">{form.email}</strong>. Open it to verify your email address and finish creating your account.
            </p>
        </div>
        <p class="type-secondary text-muted-foreground">
            Already confirmed? <a href={resolve("/auth/login")} class="font-medium text-primary-foreground underline-offset-4 hover:underline">Log in</a>
        </p>
    </section>
{:else}
    <header>
        <h1 class="type-page-title">Create account</h1>
        <p class="mt-2 type-secondary text-muted-foreground">Save your work, understand your progress, and practice with purpose.</p>
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

    <Button type="submit" size="lg" class="w-full">Create account</Button>

    <p class="type-secondary text-muted-foreground">
        Already have an account? <a href={resolve("/auth/login")} class="font-medium text-primary-foreground underline-offset-4 hover:underline">Log in</a>
    </p>
{/if}
