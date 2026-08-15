<script lang="ts">
    import { enhance } from "$app/forms";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

    let { children } = $props();
</script>

<svelte:head>
    <title>ProblemCloud</title>
    <meta name="description" content="Sign in to ProblemCloud to practice competition math." />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="border-b border-border">
        <div class="mx-auto flex h-16 max-w-[760px] items-center justify-between px-4 sm:px-6">
            <a href={resolve("/welcome")} class="flex items-center gap-2 font-semibold">
                <Icon
                    name="cloud"
                    class={offlineMode.isLocal ? "text-muted-foreground transition-colors" : "text-primary-foreground transition-colors"}
                    aria-hidden="true"
                />
                <span>ProblemCloud</span>
            </a>
            <Button href="/about" variant="ghost" size="sm">About</Button>
        </div>
    </header>

    <main class="mx-auto flex w-full max-w-[760px] flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <form method="POST" use:enhance class="w-full max-w-[560px] space-y-6">
            {@render children()}
        </form>
    </main>
</div>
