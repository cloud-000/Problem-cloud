<script lang="ts">
    import type { SupabaseClient, User } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Combobox } from "$lib/components/combobox";
    import { toasts } from "$lib/state/toast.svelte";
    import { modal } from "$lib/state/modal.svelte";
    import { fetchProfiles } from "$lib/admin";
    import { onMount } from "svelte";

    let { supabase, user }: { supabase: SupabaseClient<Database>; user: User | null } = $props();

    // Form state
    let title = $state("");
    let message = $state("");
    let recipientType = $state<"everyone" | "specific">("everyone");
    let selectedUserIds = $state<string[]>([]);
    let severity = $state<"info" | "success" | "warning" | "error">("info");
    let duration = $state(5); // 0 = permanent, 1-30 = seconds

    // UI state
    let sending = $state(false);
    let loadingProfiles = $state(true);
    let profilesList = $state<any[]>([]);
    let notificationsList = $state<any[]>([]);
    let loadingHistory = $state(true);

    async function loadProfiles() {
        loadingProfiles = true;
        try {
            // Note: Standard fetchProfiles call is acceptable for initial scaling.
            // Future optimization: If the user base grows, replace with an autocomplete search RPC.
            profilesList = await fetchProfiles(supabase, "newest");
        } catch (e) {
            console.error("Failed to load profiles:", e);
            toasts.error("Failed to load user profiles.");
        } finally {
            loadingProfiles = false;
        }
    }

    async function loadHistory() {
        loadingHistory = true;
        try {
            const { data, error } = await supabase
                .from("notifications")
                .select("*, sender:profiles!notifications_sender_id_fkey(username)")
                .order("created_at", { ascending: false });

            if (error) throw error;
            notificationsList = data ?? [];
        } catch (e) {
            console.error("Failed to load announcements history:", e);
            toasts.error("Failed to load announcements history.");
        } finally {
            loadingHistory = false;
        }
    }

    async function handleSend() {
        if (!user) {
            toasts.error("You must be logged in to send announcements.");
            return;
        }
        if (!title.trim() || !message.trim()) {
            toasts.warning("Please fill in both title and message.");
            return;
        }
        if (recipientType === "specific" && selectedUserIds.length === 0) {
            toasts.warning("Please select at least one recipient.");
            return;
        }

        sending = true;
        try {
            const targets = recipientType === "everyone" ? null : selectedUserIds;
            const durationMs = duration === 0 ? 0 : duration * 1000;

            const { error } = await supabase
                .from("notifications")
                .insert({
                    title: title.trim(),
                    message: message.trim(),
                    targets,
                    sender_id: user.id,
                    payload: {
                        type: severity,
                        duration: durationMs,
                    },
                });

            if (error) throw error;

            toasts.success("Announcement broadcast successfully!");
            title = "";
            message = "";
            selectedUserIds = [];
            await loadHistory();
        } catch (e) {
            console.error("Failed to send announcement:", e);
            toasts.error((e as Error).message || "Failed to send announcement.");
        } finally {
            sending = false;
        }
    }

    async function handleDelete(id: number) {
        if (
            !(await modal.confirm({
                title: "Delete announcement",
                message:
                    "Are you sure you want to delete this announcement? It will be removed for all users.",
                confirmLabel: "Delete",
                confirmVariant: "destructive",
            }))
        ) {
            return;
        }

        try {
            const { error } = await supabase
                .from("notifications")
                .delete()
                .eq("id", id);

            if (error) throw error;

            toasts.success("Announcement deleted.");
            notificationsList = notificationsList.filter((n) => n.id !== id);
        } catch (e) {
            console.error("Failed to delete announcement:", e);
            toasts.error((e as Error).message || "Failed to delete announcement.");
        }
    }

    function getTargetsDisplay(targets: string[] | null) {
        if (!targets) return "Everyone";
        if (targets.length === 0) return "No one";

        const names = targets.map((id) => {
            const profile = profilesList.find((p) => p.id === id);
            return profile?.username || id.slice(0, 8);
        });

        if (names.length <= 3) {
            return names.join(", ");
        }
        return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
    }

    function formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }

    onMount(() => {
        loadProfiles();
        loadHistory();
    });

    const severityOptions = [
        {
            value: "info",
            label: "Info",
            icon: "info",
            colorClass: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20",
            buttonClass: "hover:bg-blue-500/5 focus-visible:ring-blue-500/50",
            activeClass: "bg-blue-500/20 border-blue-500 text-blue-700 dark:text-blue-300 font-semibold",
        },
        {
            value: "success",
            label: "Success",
            icon: "check_circle",
            colorClass: "text-correct bg-correct/10 border-correct/20",
            buttonClass: "hover:bg-correct/5 focus-visible:ring-correct/50",
            activeClass: "bg-correct/20 border-correct text-correct font-semibold",
        },
        {
            value: "warning",
            label: "Warning",
            icon: "warning",
            colorClass: "text-unsure bg-unsure/10 border-unsure/20",
            buttonClass: "hover:bg-unsure/5 focus-visible:ring-unsure/50",
            activeClass: "bg-unsure/20 border-unsure text-unsure font-semibold",
        },
        {
            value: "error",
            label: "Error",
            icon: "error",
            colorClass: "text-destructive bg-destructive/10 border-destructive/20",
            buttonClass: "hover:bg-destructive/5 focus-visible:ring-destructive/50",
            activeClass: "bg-destructive/20 border-destructive text-destructive font-semibold",
        },
    ];

    let userOptions = $derived(
        profilesList.map((p) => ({
            value: p.id,
            label: p.username || "user_" + p.id.slice(0, 8),
        })),
    );
</script>

<div class="grid w-full grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
    <div
        class="flex flex-col gap-5 lg:col-span-5"
    >
        <div>
            <h2 class="type-section-title text-foreground">New announcement</h2>
            <p class="mt-1 type-secondary text-muted-foreground">
                Compose and broadcast a toast notification to targeted application users.
            </p>
        </div>

        <form onsubmit={(e) => { e.preventDefault(); handleSend(); }} class="flex flex-col gap-4 border-t border-border pt-4">
            <!-- Title -->
            <div class="flex flex-col gap-1.5">
                <label for="announcement-title" class="type-caption text-muted-foreground">
                    Title
                </label>
                <Input
                    id="announcement-title"
                    bind:value={title}
                    placeholder="e.g. Maintenance Scheduled"
                    disabled={sending}
                />
            </div>

            <!-- Message -->
            <div class="flex flex-col gap-1.5">
                <label for="announcement-message" class="type-caption text-muted-foreground">
                    Message
                </label>
                <textarea
                    id="announcement-message"
                    bind:value={message}
                    placeholder="Describe the announcement details..."
                    disabled={sending}
                    rows="3"
                    class="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent px-2.5 py-1.5 text-base shadow-xs transition-[color,box-shadow] focus-visible:ring-3 aria-invalid:ring-3 md:text-sm placeholder:text-muted-foreground w-full min-w-0 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y"
                ></textarea>
            </div>

            <!-- Target Selection -->
            <div class="flex flex-col gap-2">
                <span class="type-caption text-muted-foreground">
                    Send To
                </span>
                <div class="flex gap-2">
                    <button
                        type="button"
                        onclick={() => recipientType = "everyone"}
                        class="flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition duration-150 outline-none select-none flex items-center justify-center gap-1.5 cursor-pointer {recipientType === 'everyone' ? 'bg-primary text-primary-foreground border-primary shadow-xs font-semibold' : 'bg-surface-container-low text-muted-foreground border-border hover:bg-surface-container'}"
                    >
                        <Icon name="groups" fontsize="1.1rem" />
                        Everyone
                    </button>
                    <button
                        type="button"
                        onclick={() => recipientType = "specific"}
                        class="flex-1 py-1.5 px-3 rounded-lg border text-sm font-medium transition duration-150 outline-none select-none flex items-center justify-center gap-1.5 cursor-pointer {recipientType === 'specific' ? 'bg-primary text-primary-foreground border-primary shadow-xs font-semibold' : 'bg-surface-container-low text-muted-foreground border-border hover:bg-surface-container'}"
                    >
                        <Icon name="person" fontsize="1.1rem" />
                        Specific Users
                    </button>
                </div>

                {#if recipientType === "specific"}
                    <div class="mt-1 transition-all duration-200">
                        {#if loadingProfiles}
                            <div class="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                <Icon name="progress_activity" class="animate-spin" fontsize="1rem" />
                                Loading user list...
                            </div>
                        {:else}
                            <Combobox
                                bind:value={selectedUserIds}
                                options={userOptions}
                                strict={true}
                                placeholder="Choose recipients..."
                                inputPlaceholder="Add recipient..."
                            />
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Severity / Color Type -->
            <div class="flex flex-col gap-1.5">
                <span class="type-caption text-muted-foreground">
                    Severity
                </span>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {#each severityOptions as option (option.value)}
                        {@const isActive = severity === option.value}
                        <button
                            type="button"
                            onclick={() => severity = option.value as any}
                            class="py-1.5 px-2.5 rounded-lg border text-xs font-medium transition duration-150 outline-none select-none flex items-center justify-center gap-1 cursor-pointer {isActive ? option.activeClass : 'bg-surface-container-low text-muted-foreground border-border/80 hover:bg-surface-container'}"
                        >
                            <Icon name={option.icon} fontsize="1rem" />
                            {option.label}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Duration Slider -->
            <div class="flex flex-col gap-1.5">
                <div class="flex justify-between items-center">
                    <label for="announcement-duration" class="type-caption text-muted-foreground">
                        Duration
                    </label>
                    <span class="type-caption text-primary">
                        {duration === 0 ? "Sticky (Permanent)" : `${duration} seconds`}
                    </span>
                </div>
                <div class="flex items-center gap-3">
                    <input
                        id="announcement-duration"
                        type="range"
                        min="0"
                        max="30"
                        step="1"
                        bind:value={duration}
                        disabled={sending}
                        class="w-full h-1.5 bg-surface-container rounded-lg appearance-none cursor-pointer accent-primary-foreground"
                    />
                </div>
                <p class="type-caption text-muted-foreground">
                    Drag to 0 to keep the toast onscreen until the user clicks to close it.
                </p>
            </div>

            <!-- Submit -->
            <Button
                type="submit"
                disabled={sending}
                class="mt-2 w-full"
            >
                {#if sending}
                    <Icon name="progress_activity" class="animate-spin" fontsize="1.1rem" />
                    Broadcasting...
                {:else}
                    <Icon name="send" fontsize="1.1rem" />
                    Broadcast Announcement
                {/if}
            </Button>
        </form>
    </div>

    <div
        class="flex flex-col gap-5 lg:col-span-7"
    >
        <div class="flex items-center justify-between">
            <div>
                <h2 class="type-section-title text-foreground">Broadcast history</h2>
                <p class="mt-1 type-secondary text-muted-foreground">
                    View previous announcements or terminate active broadcasts.
                </p>
            </div>
            <button
                type="button"
                onclick={loadHistory}
                disabled={loadingHistory}
                class="flex size-8 items-center justify-center rounded-lg hover:bg-surface-container text-muted-foreground hover:text-foreground transition cursor-pointer"
                title="Refresh history"
            >
                <Icon name="refresh" class={loadingHistory ? "animate-spin" : ""} />
            </button>
        </div>

        {#if loadingHistory && notificationsList.length === 0}
            <div class="flex items-center gap-2 border-t border-border py-16 type-secondary text-muted-foreground">
                <Icon name="progress_activity" class="animate-spin text-muted-foreground" fontsize="1.8rem" />
                Loading announcement history…
            </div>
        {:else if notificationsList.length === 0}
            <div class="flex flex-col items-start gap-1 border-y border-border py-8">
                    <h3 class="type-section-title text-foreground">No announcements found</h3>
                    <p class="type-secondary text-muted-foreground">
                        Your sent notifications will appear here.
                    </p>
            </div>
        {:else}
            <div class="flex max-h-[600px] flex-col overflow-y-auto border-t border-border">
                {#each notificationsList as item (item.id)}
                    {@const opt = severityOptions.find(o => o.value === (item.payload?.type || "info")) || severityOptions[0]}
                    <div
                        class="relative flex gap-4 border-b border-border py-4"
                    >
                        <!-- Status indicator / icon -->
                        <div class="flex size-8 shrink-0 items-center justify-center {opt.colorClass}">
                            <Icon name={opt.icon} fontsize="1.1rem" />
                        </div>

                        <!-- Main Content -->
                        <div class="flex-1 min-w-0 pr-6">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="type-body font-medium text-foreground truncate">
                                    {item.title}
                                </span>
                                <span class="type-caption {opt.colorClass}">
                                    {opt.label}
                                </span>
                                {#if item.payload?.duration === 0}
                                    <span class="flex items-center gap-0.5 type-caption text-muted-foreground">
                                        <Icon name="push_pin" fontsize="0.8rem" />
                                        Sticky
                                    </span>
                                {/if}
                            </div>

                            <p class="mt-1.5 type-secondary whitespace-pre-line text-muted-foreground">
                                {item.message}
                            </p>

                            <!-- Footer details -->
                            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-2 type-caption text-muted-foreground">
                                <span class="flex items-center gap-1">
                                    <Icon name="person" fontsize="0.9rem" />
                                    By: {item.sender?.username || "Unknown Admin"}
                                </span>
                                <span class="flex items-center gap-1">
                                    <Icon name="groups" fontsize="0.9rem" />
                                    To: {getTargetsDisplay(item.targets)}
                                </span>
                                <span class="flex items-center gap-1">
                                    <Icon name="schedule" fontsize="0.9rem" />
                                    {formatDate(item.created_at)}
                                </span>
                            </div>
                        </div>

                        <!-- Delete Button -->
                        <button
                            type="button"
                            onclick={() => handleDelete(item.id)}
                            class="absolute top-3 right-3 text-muted-foreground/60 hover:text-destructive transition p-1 rounded-md hover:bg-destructive/5 cursor-pointer"
                            title="Delete announcement"
                        >
                            <Icon name="delete" fontsize="1.1rem" />
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>
