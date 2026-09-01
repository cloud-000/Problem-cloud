<script lang="ts">
    import { enhance } from "$app/forms";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Icon } from "$lib/components/icon";
    import { offlineMode } from "$lib/state/offline-mode.svelte";
    import { setAuthForm } from "./form-state";

    let { children } = $props();

    let action = $derived(
        page.url.pathname === "/auth/login" || page.url.pathname === "/auth/signup"
            ? "?/password"
            : undefined,
    );

    const authForm = $state({ submitting: false });
    setAuthForm(authForm);
</script>

<svelte:head>
    <title>ProblemCloud</title>
    <meta name="description" content="Sign in to ProblemCloud to practice competition math." />
</svelte:head>

<!-- Use document scrolling for long forms. iOS standalone web apps can size a
     fixed scroll container to a shorter viewport and leave a gap below it. -->
<div class="auth-shell flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground">
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
        <form
            method="POST"
            {action}
            aria-busy={authForm.submitting}
            use:enhance={({ cancel }) => {
                if (authForm.submitting) {
                    cancel();
                    return;
                }
                authForm.submitting = true;
                return async ({ update }) => {
                    try {
                        await update();
                    } finally {
                        authForm.submitting = false;
                    }
                };
            }}
            class="w-full max-w-[560px] space-y-6"
        >
            {@render children()}
        </form>
    </main>
</div>

<style>
    @media (pointer: coarse) {
        .auth-shell {
            padding-top: var(--safe-area-top);
        }
    }
</style>
