<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ToastContainer } from "$lib/components/toast";
    import { Theme } from "$lib/utils/Theme.svelte";
    import { offlineMode } from "$lib/state/offline-mode.svelte";

    let { data, children } = $props();
    // The public shell is told only whether someone is signed in — never the
    // session itself (see `+layout.server.ts`).
    let signedIn = $derived(data.signedIn);

    function toggleTheme() {
        Theme.setUserTheme(Theme.theme === "light" ? "dark" : "light");
    }
</script>

<!-- Let the document own vertical scrolling. A fixed, nested scroll viewport is
     measured too short by iOS when this site runs as a Home Screen web app,
     leaving an unpainted band below the shell. -->
<div
    class="splash-shell bg-background text-foreground relative flex min-h-dvh flex-col overflow-x-clip"
>
    <header
        class="bg-background/85 border-border/60 sticky top-0 z-45 w-full border-b backdrop-blur-md"
    >
        <div
            class="mx-auto flex h-16 w-full max-w-[1040px] items-center justify-between gap-sm px-sm sm:gap-md sm:px-md md:px-xl"
        >
            <a
                href="/welcome"
                class="text-foreground hover:text-primary-foreground flex min-w-0 items-center gap-2 transition-colors"
            >
                <Icon
                    name="cloud"
                    fontsize="22px"
                    class={offlineMode.isLocal ? "text-muted-foreground transition-colors" : "text-primary-foreground transition-colors"}
                />
                <span
                    class="truncate text-base font-semibold tracking-[-0.01em] max-sm:sr-only"
                    >ProblemCloud</span
                >
            </a>

            <div class="flex shrink-0 items-center gap-0.5 sm:gap-2">
                <button
                    onclick={toggleTheme}
                    class="text-muted-foreground hover:text-foreground hover:bg-muted flex size-9 items-center justify-center rounded-md transition-colors"
                    aria-label={Theme.theme === "light"
                        ? "Switch to dark theme"
                        : "Switch to light theme"}
                    id="theme-toggle-btn"
                >
                    <Icon
                        name={Theme.theme === "light"
                            ? "dark_mode"
                            : "light_mode"}
                        fontsize="20px"
                    />
                </button>

                {#if signedIn}
                    <Button href="/" size="sm" id="nav-dashboard-btn"
                        >Dashboard</Button
                    >
                {:else}
                    <Button
                        href="/auth/login"
                        variant="ghost"
                        size="sm"
                        class="hidden sm:inline-flex"
                        id="nav-login-btn">Log in</Button
                    >
                    <Button href="/auth/signup" size="sm" id="nav-signup-btn">
                        <span class="sm:hidden">Sign up</span>
                        <span class="hidden sm:inline">Create account</span>
                    </Button>
                {/if}
            </div>
        </div>
    </header>

    <main class="flex-1">
        {@render children()}
    </main>

    <footer class="border-border/60 mt-xl border-t">
        <div
            class="text-muted-foreground mx-auto flex w-full max-w-[1040px] flex-col items-start justify-between gap-md px-md py-lg md:flex-row md:items-center md:px-xl"
        >
            <span class="type-caption">© 2026 ProblemCloud</span>
            <nav class="type-caption flex items-center gap-lg">
                {#if signedIn}
                    <a
                        href="/library"
                        class="hover:text-foreground transition-colors">Library</a
                    >
                {/if}
                <a
                    href="/auth/login"
                    class="hover:text-foreground transition-colors">Log in</a
                >
            </nav>
        </div>
    </footer>
</div>

<ToastContainer />

<style>
    @media (pointer: coarse) {
        .splash-shell {
            padding-top: var(--safe-area-top);
        }
    }
</style>
