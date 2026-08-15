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

<!-- The root layout clips its wrapper (`overflow-clip`), so the splash shell
     owns its own scroll container rather than relying on the document. The
     sticky header below sticks against this element. -->
<div
    class="bg-background text-foreground fixed inset-0 flex flex-col overflow-x-hidden overflow-y-auto"
>
    <header
        class="bg-background/85 border-border/60 sticky top-0 z-45 w-full border-b backdrop-blur-md"
    >
        <div
            class="mx-auto flex h-16 w-full max-w-[1040px] items-center justify-between gap-md px-md md:px-xl"
        >
            <a
                href="/welcome"
                class="text-foreground hover:text-primary-foreground flex items-center gap-2 transition-colors"
            >
                <Icon
                    name="cloud"
                    fontsize="22px"
                    class={offlineMode.isLocal ? "text-muted-foreground transition-colors" : "text-primary-foreground transition-colors"}
                />
                <span class="text-base font-semibold tracking-[-0.01em]"
                    >ProblemCloud</span
                >
            </a>

            <div class="flex items-center gap-1 sm:gap-2">
                <a
                    href="/about"
                    class="type-secondary text-muted-foreground hover:text-foreground hidden rounded-md px-2.5 py-1.5 transition-colors sm:block"
                    >About</a
                >
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
                    <Button href="/" id="nav-dashboard-btn">Dashboard</Button>
                {:else}
                    <Button href="/auth/login" variant="ghost" id="nav-login-btn"
                        >Log in</Button
                    >
                    <Button href="/auth/signup" id="nav-signup-btn"
                        >Create account</Button
                    >
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
                <a href="/about" class="hover:text-foreground transition-colors"
                    >About</a
                >
                <a
                    href="/library"
                    class="hover:text-foreground transition-colors">Library</a
                >
                <a
                    href="/auth/login"
                    class="hover:text-foreground transition-colors">Log in</a
                >
            </nav>
        </div>
    </footer>
</div>

<ToastContainer />
