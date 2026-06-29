<script lang="ts">
    import type { PageData } from "./$types";
    import { Icon } from "$lib/components/icon";
    import { Subtabs } from "$lib/components/subtabs";
    import PracticeApproval from "./practice-approval.svelte";
    import UserFeedback from "./user-feedback.svelte";
    import UserList from "./user-list.svelte";
    import Announcements from "./announcements.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let activeTab = $state("practice-approval");
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-1">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="admin_panel_settings"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            Admin
        </h1>
        <p class="text-sm text-muted-foreground">
            Manage administrative settings, review user submissions, and
            configure the application.
        </p>
    </div>

    <!-- Subtabs -->
    <Subtabs bind:value={activeTab} variant="line">
        <Subtabs.List class="mb-4">
            <Subtabs.Trigger
                value="practice-approval"
                icon="assignment_turned_in"
            >
                Answers Added
            </Subtabs.Trigger>
            <Subtabs.Trigger value="user-feedback" icon="feedback">
                Feedback
            </Subtabs.Trigger>
            <Subtabs.Trigger value="users" icon="group">Users</Subtabs.Trigger>
            <Subtabs.Trigger value="announcements" icon="campaign">
                Announcements
            </Subtabs.Trigger>
            <Subtabs.Trigger value="settings" icon="settings">
                Config
            </Subtabs.Trigger>
        </Subtabs.List>

        <Subtabs.Content value="practice-approval">
            <PracticeApproval {supabase} />
        </Subtabs.Content>

        <Subtabs.Content value="user-feedback">
            <UserFeedback {supabase} />
        </Subtabs.Content>

        <Subtabs.Content value="users">
            <UserList {supabase} />
        </Subtabs.Content>

        <Subtabs.Content value="announcements">
            <Announcements {supabase} {user} />
        </Subtabs.Content>

        <Subtabs.Content value="settings">
            <div
                class="flex flex-col items-center justify-center py-16 gap-3 text-center border border-border/60 rounded-xl bg-surface-container-low"
            >
                <div
                    class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
                >
                    <Icon name="construction" fontsize="1.8rem" />
                </div>
                <div>
                    <h3 class="text-sm font-semibold">
                        Settings Under Construction
                    </h3>
                    <p class="text-xs text-muted-foreground mt-0.5">
                        Admin settings and controls will be available here in a
                        future update.
                    </p>
                </div>
            </div>
        </Subtabs.Content>
    </Subtabs>
</div>
