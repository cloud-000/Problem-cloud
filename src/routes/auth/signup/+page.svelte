<script lang="ts">
    import { resolve } from "$app/paths";
    import { AUTH_MAIL_FROM } from "$lib/auth";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { getAuthForm } from "../form-state";
    import type { ActionData } from "./$types";

    let { form }: { form: ActionData } = $props();

    const authForm = getAuthForm();

    let password = $state("");
    let passwordConfirm = $state("");
    let confirmRef = $state<HTMLInputElement | null>(null);

    const mismatch = $derived(
        passwordConfirm.length > 0 && password !== passwordConfirm,
    );

    function syncConfirmValidity(nextPassword = password, nextConfirm = passwordConfirm) {
        confirmRef?.setCustomValidity(
            nextConfirm.length > 0 && nextPassword !== nextConfirm
                ? "Passwords do not match."
                : "",
        );
    }
</script>

<svelte:head><title>Create account — ProblemCloud</title></svelte:head>

{#if form?.confirmationRequired}
    <section aria-labelledby="confirmation-title" class="space-y-5">
        <Icon name="mark_email_unread" class="text-primary-foreground" fontsize={28} weight={500} aria-hidden="true" />
        <div>
            <h1 id="confirmation-title" class="type-page-title">Check your email</h1>
            <p class="mt-2 type-secondary text-muted-foreground">
                We sent a confirmation link to <strong class="font-medium text-foreground">{form.email}</strong> from
                <strong class="font-medium text-foreground">{AUTH_MAIL_FROM}</strong>.
                Open it to verify your address and finish creating your account.
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
        <label class="flex flex-col gap-1.5 type-secondary font-medium text-foreground">
            <span>Email address</span>
            <Input
                name="email"
                type="email"
                required
                value={form?.email ?? ""}
                placeholder="you@example.com"
                autocomplete="email"
                class="h-11 bg-background"
            />
        </label>
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
        <label class="flex flex-col gap-1.5 type-secondary font-medium text-foreground">
            <span>Password</span>
            <Input
                name="password"
                type="password"
                required
                minlength={6}
                bind:value={password}
                placeholder="Create a secure password"
                autocomplete="new-password"
                class="h-11 bg-background"
                oninput={(event) => {
                    syncConfirmValidity(
                        (event.currentTarget as HTMLInputElement).value,
                        passwordConfirm,
                    );
                }}
            />
        </label>
        <label class="flex flex-col gap-1.5 type-secondary font-medium text-foreground">
            <span>Confirm password</span>
            <Input
                name="password_confirm"
                type="password"
                required
                minlength={6}
                bind:ref={confirmRef}
                bind:value={passwordConfirm}
                placeholder="Type the password again"
                autocomplete="new-password"
                aria-invalid={mismatch}
                class="h-11 bg-background"
                oninput={(event) => {
                    syncConfirmValidity(
                        password,
                        (event.currentTarget as HTMLInputElement).value,
                    );
                }}
            />
            {#if mismatch}
                <span class="type-secondary font-normal text-error">Passwords do not match.</span>
            {/if}
        </label>
    </div>

    {#if form?.message}
        <p role="alert" class="border-l-2 border-error px-3 py-2 type-secondary text-error">{form.message}</p>
    {/if}

    <Button type="submit" size="lg" class="w-full" disabled={authForm.submitting}>Create account</Button>

    <Button type="submit" formaction="?/google" formnovalidate variant="outline" size="lg" class="w-full" disabled={authForm.submitting} data-sveltekit-reload>
        Sign up with Google
    </Button>

    <p class="type-secondary text-muted-foreground">
        Already have an account? <a href={resolve("/auth/login")} class="font-medium text-primary-foreground underline-offset-4 hover:underline">Log in</a>
    </p>
{/if}
