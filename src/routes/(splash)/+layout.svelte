<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ToastContainer } from "$lib/components/toast";
    import { Theme } from "$lib/utils/Theme.svelte";

    let { data, children } = $props();
    let session = $derived(data.session);

    function toggleTheme() {
        Theme.theme = Theme.theme === "light" ? "dark" : "light";
    }
</script>

<div
    class="fixed inset-0 overflow-y-auto overflow-x-hidden flex flex-col bg-background text-foreground transition-colors duration-300"
>
    <!-- Background grid -->
    <div class="absolute inset-0 math-grid pointer-events-none -z-20"></div>

    <!-- Background blurred decorative circles -->
    <div
        class="absolute top-[20%] left-[-10%] w-[35vw] h-[35vw] rounded-full bg-[var(--algebra)] opacity-[0.06] blur-[80px] pointer-events-none -z-10 floating-shape"
    ></div>
    <div
        class="absolute bottom-[20%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-[var(--geometry)] opacity-[0.06] blur-[100px] pointer-events-none -z-10 floating-shape-delayed"
    ></div>

    <!-- Header / Navbar -->
    <header
        class="sticky top-0 z-45 w-full backdrop-blur-md bg-background/80 border-b border-border/50 transition-colors"
    >
        <div
            class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between"
        >
            <a href="/welcome" class="flex items-center gap-2 hover:opacity-90 transition-opacity">
                <Icon
                    class="text-[var(--primary-foreground)] font-bold animate-pulse"
                    fontsize="28px">cloud</Icon
                >
                <span
                    class="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent"
                    >ProblemCloud</span
                >
            </a>

            <!-- Nav Links (Desktop) -->
            <nav class="hidden md:flex items-center gap-8">
                <a
                    href="/welcome#features"
                    class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >Features</a
                >
                <a
                    href="/welcome#sandbox"
                    class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >Practice Sandbox</a
                >
                <a
                    href="/welcome#about"
                    class="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >FAQ</a
                >
            </nav>

            <!-- Actions -->
            <div class="flex items-center gap-3">
                <button
                    onclick={toggleTheme}
                    class="p-2 rounded-md hover:bg-surface-container transition-colors text-muted-foreground hover:text-foreground focus-visible:outline-hidden cursor-pointer"
                    aria-label="Toggle theme"
                    id="theme-toggle-btn"
                >
                    <Icon
                        name={Theme.theme === "light"
                            ? "dark_mode"
                            : "light_mode"}
                        fontsize="20px"
                    />
                </button>

                {#if session}
                    <Button href="/" variant="default" id="nav-dashboard-btn"
                        >Dashboard</Button
                    >
                {:else}
                    <Button
                        href="/auth/login"
                        variant="ghost"
                        id="nav-login-btn">Log In</Button
                    >
                    <Button
                        href="/auth/signup"
                        variant="default"
                        id="nav-signup-btn">Sign Up</Button
                    >
                {/if}
            </div>
        </div>
    </header>

    <main class="flex-grow">
        {@render children()}
    </main>

    <!-- Footer -->
    <footer
        class="w-full py-8 border-t border-border/30 bg-surface-container-lowest transition-colors text-center text-xs text-muted-foreground mt-auto"
    >
        <div
            class="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4"
        >
            <span>© 2026 ProblemCloud. All rights reserved.</span>
            <div class="flex items-center gap-6">
                <a href="/about" class="hover:text-foreground transition-colors"
                    >About Us</a
                >
                <a
                    href="/library"
                    class="hover:text-foreground transition-colors">Library</a
                >
                <a
                    href="/welcome#sandbox"
                    class="hover:text-foreground transition-colors">Practice</a
                >
            </div>
        </div>
    </footer>
</div>

<ToastContainer />

<style>
    .math-grid {
        background-size: 36px 36px;
        background-image:
            linear-gradient(to right, var(--border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border) 1px, transparent 1px);
        mask-image: radial-gradient(
            circle at center,
            black 10%,
            transparent 75%
        );
        opacity: 0.25;
    }

    @keyframes float {
        0%,
        100% {
            transform: translateY(0px) rotate(0deg);
        }
        50% {
            transform: translateY(-12px) rotate(3deg);
        }
    }

    .floating-shape {
        animation: float 10s ease-in-out infinite;
    }
    .floating-shape-delayed {
        animation: float 14s ease-in-out infinite;
        animation-delay: 3s;
    }
</style>
