<script lang="ts">
    import { Button } from "$lib/components/button/.";
    import { Input } from "$lib/components/input/.";
    import type { ActionData } from "./$types";

    let { form }: { form: ActionData } = $props();

    const items = [
        {
            name: "email",
            type: "email",
            label: "Email address",
            placeholder: "you@example.com",
            autocomplete: "email",
        },
        {
            name: "username",
            type: "text",
            label: "Username",
            placeholder: "What should we call you?",
            autocomplete: "username",
        },
        {
            name: "password",
            type: "password",
            label: "Password",
            placeholder: "Create a secure password",
            autocomplete: "new-password",
        },
    ] as const;
</script>

<header>
    <p class="mb-xs text-sm font-semibold text-primary-foreground">Join ProblemCloud</p>
    <h2 class="font-serif text-3xl font-semibold tracking-tight text-foreground">
        Create your account
    </h2>
    <p class="mt-sm leading-relaxed text-muted-foreground">
        Start practicing, save your progress, and grow one problem at a time.
    </p>
</header>

<div class="flex flex-col gap-md">
    {#each items as item}
        <label class="flex flex-col gap-sm text-sm font-medium text-foreground">
            <span>{item.label}</span>
            <Input
                name={item.name}
                type={item.type}
                required
                placeholder={item.placeholder}
                autocomplete={item.autocomplete}
                class="h-11 rounded-lg border-outline-variant bg-surface-container-lowest px-md shadow-sm placeholder:text-muted-foreground/70 hover:border-outline focus-visible:border-primary-foreground focus-visible:ring-primary-foreground/20"
            />
        </label>
    {/each}
</div>

{#if form?.message}
    <p
        role="alert"
        class="rounded-lg border border-error/20 bg-error-container px-md py-sm text-sm font-medium text-on-error-container"
    >
        {form.message}
    </p>
{/if}

<Button type="submit" variant="default" size="lg" class="w-full rounded-lg font-semibold">
    Create account
</Button>

<p class="text-center text-sm text-muted-foreground">
    Already have an account?
    <a
        href="/auth/login"
        class="font-semibold text-primary-foreground underline-offset-4 hover:underline"
    >Log in</a>
</p>
