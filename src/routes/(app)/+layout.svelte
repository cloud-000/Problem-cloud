<script lang="ts">
    import * as Sidebar from "$lib/components/sidebar";
    import { ToastContainer } from "$lib/components/toast";
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
        { href: "/", icon: "home", label: "Home" },
        { href: "/practice", icon: "sprint", label: "Train" },
        { href: "/library", icon: "book_5", label: "Explore" },
        { href: "/history", icon: "history", label: "History" },
        { href: "/find", icon: "category_search", label: "Find" },
        { href: "/testing-features", icon: "labs", label: "Test" }, // Testing page
    ];
    // Sidebar state
    let expanded = $state(true);
</script>

<div
    class="flex flex-row w-full h-screen bg-background text-foreground overflow-hidden"
>
    <Sidebar.Root bind:expanded>
        <Sidebar.Header class="justify-between">
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
            {#each tabs as tab}
                {@const isActive = page.url.pathname === tab.href}
                <Sidebar.Item active={isActive} activeClass="">
                    {#snippet child({ props })}
                        <a
                            href={tab.href}
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
                            <Icon
                                fill={isActive}
                                class="shrink-0 transition-colors"
                            >
                                {tab.icon}
                            </Icon>
                            {#if expanded}
                                <span
                                    class="truncate transition-opacity duration-200"
                                    >{tab.label}</span
                                >
                            {/if}
                        </a>
                    {/snippet}
                </Sidebar.Item>
            {/each}
        </Sidebar.Group>

        <Sidebar.Footer>
            {#if session}
                {#if expanded}
                    <div
                        class="flex items-center gap-3 px-2 py-1.5 w-full bg-muted/30 rounded-md border border-border/50"
                    >
                        <div
                            class="flex items-center justify-center size-8 rounded-full bg-primary text-primary-foreground font-semibold text-sm shrink-0"
                        >
                            {profile?.username?.charAt(0).toUpperCase() || "U"}
                        </div>
                        <div class="flex flex-col min-w-0">
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
                <form
                    action="/auth/logout"
                    method="POST"
                    use:enhance
                    class="w-full flex justify-start data-[expanded=false]:justify-center"
                    data-expanded={expanded}
                >
                    <Sidebar.Item type="submit" icon="logout" label="Logout" />
                </form>
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

    <div class="flex flex-col flex-1 h-full overflow-y-auto p-0">
        {@render children()}
    </div>

    <ToastContainer onDismiss={onToastClose} />
</div>
