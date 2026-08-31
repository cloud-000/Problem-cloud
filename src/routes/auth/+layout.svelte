<script lang="ts">
    import { enhance } from "$app/forms";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Icon } from "$lib/components/icon";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

    let { children } = $props();

    let action = $derived(
        page.url.pathname === "/auth/login" || page.url.pathname === "/auth/signup"
            ? "?/password"
            : undefined,
    );
</script>

<svelte:head>
    <title>ProblemCloud</title>
    <meta name="description" content="Sign in to ProblemCloud to practice competition math." />
</svelte:head>

<!-- The root shell clips overflow, so auth owns a fixed scroll container. This keeps
     long forms reachable on short mobile viewports. -->
<div class="fixed inset-0 flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto bg-background text-foreground">
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
        </div>
    </header>

    <main class="mx-auto flex w-full max-w-[760px] flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <form method="POST" {action} use:enhance class="w-full max-w-[560px] space-y-6">
            {@render children()}
        </form>
    </main>
</div>
