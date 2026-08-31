<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import type { ActionData } from "./$types";

    let { data, form }: { data: { oauthMessage: string | null }; form: ActionData } = $props();
</script>

<svelte:head><title>Log in — ProblemCloud</title></svelte:head>

<header>
    <h1 class="type-page-title">Log in</h1>
    <p class="mt-2 type-secondary text-muted-foreground">Continue your focused practice and progress.</p>
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
        <span>Password</span>
        <Input
            name="password"
            type="password"
            required
            placeholder="Enter your password"
            autocomplete="current-password"
            class="h-11 bg-background"
        />
    </label>
</div>

{#if form?.message || data.oauthMessage}
    <p role="alert" class="border-l-2 border-error px-3 py-2 type-secondary text-error">{form?.message ?? data.oauthMessage}</p>
{/if}

<Button type="submit" size="lg" class="w-full">Log in</Button>

<Button type="submit" formaction="?/google" formnovalidate variant="outline" size="lg" class="w-full" data-sveltekit-reload>
    Continue with Google
</Button>

<p class="type-secondary text-muted-foreground">
    Don’t have an account? <a href={resolve("/auth/signup")} class="font-medium text-primary-foreground underline-offset-4 hover:underline">Create account</a>
</p>
