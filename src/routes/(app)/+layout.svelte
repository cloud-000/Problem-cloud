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
    // Admin-only tabs render only for admins (admin_rank > 0).
    let visibleTabs = $derived(
        tabs.filter((t) => !t.adminOnly || (profile?.admin_rank ?? 0) > 0),
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

        // Add Test (labs)
        list.push({
            label: "Test",
            icon: "labs",
            onclick: () => goto("/testing-features"),
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
            page.url.pathname === "/testing-features" ||
            page.url.pathname.startsWith("/testing-features/")
        ) {
            return true;
        }
        return false;
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
    class="app-container flex flex-row w-full h-screen bg-background text-foreground overflow-hidden"
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
            {#if !isMobilePortrait}
                {@render sidebarLink(
                    "/settings",
                    "settings",
                    "Settings",
                    page.url.pathname === "/settings",
                )}
                {@render sidebarLink(
                    "/testing-features",
                    "labs",
                    "Test",
                    page.url.pathname === "/testing-features" ||
                        page.url.pathname.startsWith("/testing-features/"),
                )}

                <div class="footer-separator h-px bg-border/50 my-1"></div>
            {/if}

            {#if session}
                {#if expanded && !isMobilePortrait}
                    <div
                        class="profile-card flex items-center gap-3 px-2 py-1.5 w-full bg-muted/30 rounded-md border border-border/50"
                    >
                        <div
                            class="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm shrink-0"
                        >
                            {profile?.username?.charAt(0).toUpperCase() || "U"}
                        </div>
                        <div class="profile-text flex flex-col min-w-0">
                            <span
                                class="text-sm font-medium truncate text-foreground"
                                >{profile?.username || "User"}</span
                            >
                            <span class="text-xs text-muted-foreground truncate"
                                >{session.user?.email || ""}</span
                            >
                        </div>
                    </div>
                {:else}
                    <div
                        class="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm my-1 shrink-0"
                        title={profile?.username || session.user?.email}
                    >
                        {profile?.username?.charAt(0).toUpperCase() || "U"}
                    </div>
                {/if}

                {#if !isMobilePortrait}
                    <form
                        action="/auth/logout"
                        method="POST"
                        use:enhance
                        class="logout-form w-full flex justify-start data-[expanded=false]:justify-center"
                        data-expanded={expanded}
                    >
                        <Sidebar.Item
                            type="submit"
                            icon="logout"
                            label="Logout"
                        />
                    </form>
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

    <div class="flex flex-col flex-1 h-full overflow-y-auto p-0">
        {@render children()}
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
                height: 56px !important;
                border-right-width: 0px !important;
                border-top: 1px solid var(--color-border) !important;
                overflow-x: auto !important;
                scrollbar-width: none !important;
                padding: 0 8px !important;
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

            .profile-card {
                background-color: transparent !important;
                border-width: 0px !important;
                padding: 0 !important;
                width: auto !important;
                margin: 0 !important;
                flex-shrink: 0 !important;
            }

            .profile-text {
                display: none !important;
            }

            .logout-form {
                width: auto !important;
                margin: 0 !important;
                flex-shrink: 0 !important;
            }

            .footer-separator {
                display: none !important;
            }
        }
    }
</style>
