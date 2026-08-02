<script lang="ts">
    import type { PageData } from "./$types";
    import * as Page from "$lib/components/page";
    import { Subtabs } from "$lib/components/subtabs";
    import ProblemReports from "./problem-reports.svelte";
    import UserFeedback from "./user-feedback.svelte";
    import UserList from "./user-list.svelte";
    import Announcements from "./announcements.svelte";
    import RatingsAdmin from "./ratings-admin.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let activeTab = $state("problem-reports");
</script>

<svelte:head>
    <title>Admin tools · ProblemCloud</title>
</svelte:head>

<Page.Root width="unbounded" class="gap-8">
    <Page.Header
        title="Admin tools"
        description="Review community input, manage accounts, and maintain rating data."
    />

    <Subtabs bind:value={activeTab} variant="line">
        <Page.Toolbar class="border-b border-border">
            <Subtabs.List>
                <Subtabs.Trigger value="problem-reports">
                    Problem reports
                </Subtabs.Trigger>
                <Subtabs.Trigger value="user-feedback">Feedback</Subtabs.Trigger>
                <Subtabs.Trigger value="users">Users</Subtabs.Trigger>
                <Subtabs.Trigger value="announcements">Announcements</Subtabs.Trigger>
                <Subtabs.Trigger value="settings">Ratings</Subtabs.Trigger>
            </Subtabs.List>
        </Page.Toolbar>

        <Subtabs.Content value="problem-reports">
            <ProblemReports {supabase} />
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
            <RatingsAdmin {supabase} />
        </Subtabs.Content>
    </Subtabs>
</Page.Root>
