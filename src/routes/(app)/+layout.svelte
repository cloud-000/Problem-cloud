<script lang="ts">
    import * as Sidebar from "$lib/components/sidebar";
    import { ToastContainer } from "$lib/components/toast";
    import { ModalContainer } from "$lib/components/modal";
    import { page } from "$app/state";
    import { enhance } from "$app/forms";
    import { Icon } from "$lib/components/icon/.";
    import { cn } from "$lib/utils.js";
    import { toasts, type Toast } from "$lib/state/toast.svelte";
    import {
        fetchUnread,
        subscribeToNotifications,
        markRead,
        toToast,
    } from "$lib/notifications";
    import {
        DropdownMenu,
        type DropdownOption,
    } from "$lib/components/dropdown-menu";
    import { deviceDetails } from "$lib/mobile.svelte";
    import { goto } from "$app/navigation";
    import { topbar } from "$lib/state/topbar.svelte";
    import { settings } from "$lib/state/settings.svelte";

    let { data, children } = $props();
    let { supabase, session, user, profile } = $derived(data);

    // Surface notifications as toasts for authenticated users: replay unread ones on
    // load, then stream new inserts in real time. Auto-dismiss leaves them unread; only
    // an explicit close persists a read record (see markRead below).
    $effect(() => {
        if (!user) return;
        const userId = user.id;

        fetchUnread(supabase, userId).then((rows) => {
            for (const row of rows) toasts.add(toToast(row));
        });

        const channel = subscribeToNotifications(supabase, userId, (row) => {
            toasts.add(toToast(row));
        });

        return () => {
            supabase.removeChannel(channel);
        };
    });

    // Only DB-backed toasts (with a notificationId) get a persisted read record;
    // client-only toasts dismiss purely on the client.
    function onToastClose(toast: Toast) {
        if (user && toast.notificationId != null)
            markRead(supabase, user.id, toast.notificationId);
    }

    let tabs = [
        { href: "/", icon: "home", label: "Home", important: true },
        { href: "/practice", icon: "sprint", label: "Train", important: true },
        { href: "/library", icon: "book_5", label: "Explore", important: true },
        {
            href: "/history",
            icon: "history",
            label: "History",
            important: false,
        },
        {
            href: "/find",
            icon: "category_search",
            label: "Find",
            important: false,
            betaOnly: true,
        },
        {
            href: "/testing-features",
            icon: "labs",
            label: "Test",
            important: false,
            betaOnly: true,
        },
        { href: "/roadmap", icon: "map", label: "Roadmap", important: false },
        {
            href: "/admin",
            icon: "admin_panel_settings",
            label: "Admin",
            adminOnly: true,
            important: true,
        },
    ];
    // Admin-only and beta-only tabs render based on permissions and settings.
    let visibleTabs = $derived(
        tabs.filter((t) => {
            if (t.adminOnly && (profile?.admin_rank ?? 0) <= 0) return false;
            if (t.betaOnly && !settings.showBetaFeatures) return false;
            return true;
        }),
    );
    // Sidebar state
    let expanded = $state(true);

    // Track mobile portrait mode dynamically in Svelte
    let isPortrait = $state(false);

    $effect(() => {
        if (typeof window === "undefined") return;
        const media = window.matchMedia("(orientation: portrait)");
        isPortrait = media.matches;
        const handler = (e: MediaQueryListEvent) => {
            isPortrait = e.matches;
        };
        media.addEventListener("change", handler);
        return () => media.removeEventListener("change", handler);
    });

    const isMobilePortrait = $derived(deviceDetails.isMobile && isPortrait);

    // Separate tabs into important and extra for mobile portrait dropdown layout
    let importantTabs = $derived(visibleTabs.filter((t) => t.important));

    // Reference to the logout form so we can programmatically submit it on mobile portrait dropdown clicks
    let logoutForm = $state<HTMLFormElement | null>(null);

    // Build options list for the "More" dropdown
    let moreOptions = $derived.by<DropdownOption[]>(() => {
        const list: DropdownOption[] = [];

        // Add non-important tabs that are currently visible
        const extraTabs = visibleTabs.filter((t) => !t.important);
        for (const tab of extraTabs) {
            list.push({
                label: tab.label,
                icon: tab.icon,
                onclick: () => goto(tab.href),
            });
        }

        // Add divider if there are extra tabs
        if (list.length > 0) {
            list.push({ type: "divider" });
        }

        // Add Settings
        list.push({
            label: "Settings",
            icon: "settings",
            onclick: () => goto("/settings"),
        });

        // Add Logout (if session exists)
        if (session) {
            list.push({ type: "divider" });
            list.push({
                label: "Logout",
                icon: "logout",
                color: "text-destructive",
                onclick: () => {
                    logoutForm?.requestSubmit();
                },
            });
        }

        return list;
    });

    // Check if any item in the dropdown is active
    let isAnyDropdownItemActive = $derived.by(() => {
        // Check non-important tabs
        const extraTabs = visibleTabs.filter((t) => !t.important);
        if (extraTabs.some((t) => page.url.pathname === t.href)) {
            return true;
        }
        // Check Settings
        if (page.url.pathname === "/settings") {
            return true;
        }
        // Check Test
        if (
            settings.showBetaFeatures &&
            (page.url.pathname === "/testing-features" ||
                page.url.pathname.startsWith("/testing-features/"))
        ) {
            return true;
        }
        return false;
    });

    let profileOptions = $derived.by<DropdownOption[]>(() => {
        const list: DropdownOption[] = [];

        if (profile) {
            list.push({
                label: profile.username || "User",
                type: "header",
            });
        }
        if (session?.user?.email) {
            list.push({
                label: session.user.email,
                type: "header",
            });
        }

        if (list.length > 0) {
            list.push({ type: "divider" });
        }

        list.push({
            label: "Settings",
            icon: "settings",
            onclick: () => goto("/settings"),
        });

        if (settings.showBetaFeatures) {
            list.push({
                label: "Test",
                icon: "labs",
                onclick: () => goto("/testing-features"),
            });
        }

        if (session) {
            list.push({ type: "divider" });
            list.push({
                label: "Logout",
                icon: "logout",
                color: "text-destructive",
                onclick: () => {
                    logoutForm?.requestSubmit();
                },
            });
        }

        return list;
    });
</script>

{#snippet sidebarLink(
    href: string,
    icon: string,
    label: string,
    isActive: boolean,
)}
    <Sidebar.Item active={isActive} activeClass="" {label}>
        {#snippet child({ props })}
            <a
                {href}
                {...props}
                class={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 outline-none select-none",
                    isActive
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
                    expanded
                        ? "justify-start"
                        : "justify-center px-0 w-10 h-10",
                )}
            >
                <Icon fill={isActive} class="shrink-0 transition-colors">
                    {icon}
                </Icon>
                {#if expanded}
                    <span class="truncate transition-opacity duration-200"
                        >{label}</span
                    >
                {/if}
            </a>
        {/snippet}
    </Sidebar.Item>
{/snippet}

<div
    class="app-container flex flex-row w-full h-dvh bg-background text-foreground overflow-hidden"
>
    <Sidebar.Root bind:expanded>
        <Sidebar.Header class={expanded ? "justify-between" : "justify-center"}>
            {#if expanded}
                <div class="flex items-center gap-2 text-primary-foreground">
                    <Icon class="font-bold animate-pulse" fontsize="24px"
                        >cloud</Icon
                    >
                    <span class="text-base font-semibold tracking-tight"
                        >ProblemCloud</span
                    >
                </div>
            {/if}
            <Sidebar.Trigger />
        </Sidebar.Header>

        <Sidebar.Group heading="Navigation">
            {#if isMobilePortrait}
                {#each importantTabs as tab}
                    {@const isActive = page.url.pathname === tab.href}
                    {@render sidebarLink(
                        tab.href,
                        tab.icon,
                        tab.label,
                        isActive,
                    )}
                {/each}
                <Sidebar.Item
                    active={isAnyDropdownItemActive}
                    activeClass=""
                    label="More"
                >
                    {#snippet child({ props })}
                        <DropdownMenu
                            options={moreOptions}
                            class="w-full h-full"
                            triggerClass="w-full h-full flex items-center justify-center"
                        >
                            <button
                                type="button"
                                {...props}
                                class={cn(
                                    props.class,
                                    isAnyDropdownItemActive
                                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                                        : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
                                    "justify-center px-0 w-10 h-10",
                                )}
                                aria-label="More options"
                            >
                                <Icon
                                    fill={isAnyDropdownItemActive}
                                    class="shrink-0 transition-colors"
                                >
                                    more_horiz
                                </Icon>
                            </button>
                        </DropdownMenu>
                    {/snippet}
                </Sidebar.Item>
            {:else}
                {#each visibleTabs as tab}
                    {@const isActive = page.url.pathname === tab.href}
                    {@render sidebarLink(
                        tab.href,
                        tab.icon,
                        tab.label,
                        isActive,
                    )}
                {/each}
            {/if}
        </Sidebar.Group>

        <Sidebar.Footer>
            {#if session}
                {#if isMobilePortrait}
                    <div
                        class="flex items-center justify-center w-11 h-11 shrink-0"
                    >
                        <DropdownMenu options={profileOptions}>
                            <button
                                type="button"
                                class="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:ring-2 hover:ring-primary/20 transition-all outline-none cursor-pointer"
                                title={profile?.username || session.user?.email}
                                aria-label="Profile menu"
                            >
                                {profile?.username?.charAt(0).toUpperCase() ||
                                    "U"}
                            </button>
                        </DropdownMenu>
                    </div>
                {:else}
                    {@render sidebarLink(
                        "/settings",
                        "settings",
                        "Settings",
                        page.url.pathname === "/settings",
                    )}
                {/if}
            {:else}
                <Sidebar.Item
                    href="/auth/login"
                    icon="login"
                    label="Log In"
                    active={page.url.pathname === "/auth/login"}
                />
            {/if}
        </Sidebar.Footer>
    </Sidebar.Root>

    {#if session}
        <form
            bind:this={logoutForm}
            action="/auth/logout"
            method="POST"
            use:enhance
            class="hidden"
        ></form>
    {/if}

    <div class="flex flex-col flex-1 h-full overflow-hidden">
        {#if topbar.visible || !isMobilePortrait}
            <div
                class="relative z-30 flex h-12 shrink-0 items-center justify-between gap-x-3 gap-y-2 border-b border-border/50 px-2 select-none"
            >
                <div
                    class="absolute inset-0 bg-background backdrop-blur-(--backdrop-blur) -z-10"
                ></div>
                {#if topbar.leftSnippet}
                    {@render topbar.leftSnippet()}
                {:else}
                    <div class="flex items-center gap-2">
                        {#if topbar.backHref}
                            <a
                                href={topbar.backHref}
                                class="inline-flex items-center rounded-md h-8 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                aria-label={topbar.backLabel || "Back"}
                            >
                                <Icon name="arrow_back" class="size-5" />
                            </a>
                        {/if}
                        {#if topbar.title}
                            <h1 class="text-sm font-semibold">
                                {topbar.title}
                            </h1>
                        {/if}
                    </div>
                {/if}

                <div class="flex items-center gap-3">
                    {#if topbar.rightSnippet}
                        {@render topbar.rightSnippet()}
                    {/if}

                    {#if !isMobilePortrait && session}
                        <DropdownMenu options={profileOptions}>
                            <button
                                type="button"
                                class="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:ring-2 hover:ring-primary/20 transition-all outline-none cursor-pointer"
                                aria-label="Profile menu"
                            >
                                {profile?.username?.charAt(0).toUpperCase() ||
                                    "U"}
                            </button>
                        </DropdownMenu>
                    {/if}
                </div>
            </div>
        {/if}
        <div class="flex-1 overflow-y-auto overscroll-contain p-0">
            {@render children()}
        </div>
    </div>

    <ToastContainer onDismiss={onToastClose} />
    <ModalContainer />
</div>

<style>
    @media (orientation: portrait) {
        @scope (.is-mobile) {
            .app-container {
                flex-direction: column-reverse !important;
            }

            :global([data-slot="sidebar-root"]) {
                flex-direction: row !important;
                align-items: center !important;
                width: 100% !important;
                /* Grow the bar by the bottom safe-area inset (home indicator /
                   Safari toolbar) so the 56px of interactive content sits above it. */
                height: calc(56px + env(safe-area-inset-bottom)) !important;
                border-right-width: 0px !important;
                border-top: 1px solid var(--color-border) !important;
                overflow-x: auto !important;
                scrollbar-width: none !important;
                padding: 0 8px env(safe-area-inset-bottom) 8px !important;
                background-color: var(--color-surface-container-low) !important;
            }

            :global([data-slot="sidebar-root"])::-webkit-scrollbar {
                display: none !important;
            }

            :global([data-slot="sidebar-header"]) {
                display: none !important;
            }

            :global([data-slot="sidebar-group"]) {
                flex-direction: row !important;
                padding: 0 !important;
                margin: 0 !important;
                width: auto !important;
                flex-shrink: 0 !important;
            }

            :global([data-slot="sidebar-group-content"]) {
                flex-direction: row !important;
                align-items: center !important;
                gap: 4px !important;
                flex-shrink: 0 !important;
            }

            :global([data-slot="sidebar-footer"]) {
                flex-direction: row !important;
                margin-top: 0 !important;
                border-top-width: 0px !important;
                padding: 0 8px 0 0 !important;
                align-items: center !important;
                gap: 4px !important;
                flex-shrink: 0 !important;
                margin-left: auto !important;
            }

            :global([data-slot="sidebar-item"]) span {
                display: none !important;
            }

            :global([data-slot="sidebar-item"]) {
                width: 44px !important;
                height: 44px !important;
                padding: 0 !important;
                justify-content: center !important;
                align-items: center !important;
                flex-shrink: 0 !important;
            }

            :global([data-slot="sidebar-item"] a) {
                width: 40px !important;
                height: 40px !important;
                padding: 0 !important;
                justify-content: center !important;
                align-items: center !important;
                flex-shrink: 0 !important;
            }
        }
    }
</style>
