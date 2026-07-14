<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button/.";
    import { Icon } from "$lib/components/icon/.";
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

{#if form?.confirmationRequired}
    <div class="flex flex-col items-center py-lg text-center">
        <div
            class="mb-lg grid size-16 place-items-center rounded-full bg-secondary-container text-on-secondary-container shadow-sm"
        >
            <Icon name="mark_email_unread" fontsize={32} weight={500} aria-hidden="true" />
        </div>

        <p class="mb-xs text-sm font-semibold text-primary-foreground">One more step</p>
        <h2 class="font-serif text-3xl font-semibold tracking-tight text-foreground">
            Check your email
        </h2>
        <p class="mt-md max-w-md leading-relaxed text-muted-foreground">
            We sent a confirmation link to
            <strong class="font-semibold text-foreground">{form.email}</strong>. Open it to verify
            your email address and finish creating your account.
        </p>

        <p class="mt-xl text-sm text-muted-foreground">
            Already confirmed your account?
            <a
                href={resolve("/auth/login")}
                class="font-semibold text-primary-foreground underline-offset-4 hover:underline"
                >Log in</a
            >
        </p>
    </div>
{:else}
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
        {#each items as item (item.name)}
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
            href={resolve("/auth/login")}
            class="font-semibold text-primary-foreground underline-offset-4 hover:underline"
            >Log in</a
        >
    </p>
{/if}
