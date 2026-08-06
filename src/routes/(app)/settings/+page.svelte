<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import * as Page from "$lib/components/page";
    import { Select } from "$lib/components/select";
    import { Switch } from "$lib/components/toggle";
    import { modal } from "$lib/state/modal.svelte";
    import { settings } from "$lib/state/settings.svelte";
    import { Theme } from "$lib/utils/Theme.svelte";
    import AIConnectionsSection from "./AIConnectionsSection.svelte";
    import FeedbackModal from "./FeedbackModal.svelte";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
    let { profile, session, user, supabase } = $derived(data);

    function openFeedback() {
        if (!user) return;
        modal.show(
            FeedbackModal,
            { supabase, user },
            { title: "Send feedback", size: "md" },
        );
    }
</script>

<svelte:head>
    <title>Settings · ProblemCloud</title>
</svelte:head>

<Page.Root width="narrow" class="gap-10">
    <Page.Header
        title="Settings"
        description="Manage your interface, account, and connected services."
    />

    <Page.Section
        title="Appearance"
        description="Choose how ProblemCloud looks on this device. Asymptote diagrams adjust their contrast automatically."
    >
        <div class="border-y border-border/60">
            <div
                class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div class="min-w-0">
                    <p class="type-body font-medium text-foreground">Theme</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Select a light or dark appearance.
                    </p>
                </div>
                <div class="w-full shrink-0 sm:w-56">
                    <Select
                        value={Theme.theme}
                        options={Theme.themeOptions}
                        onchange={(value) => Theme.setUserTheme(value)}
                    />
                </div>
            </div>
        </div>
    </Page.Section>

    <Page.Section
        title="Experimental features"
        description="Control access to unfinished tools on this device."
    >
        <div class="border-y border-border/60">
            <div class="flex items-center justify-between gap-6 py-4">
                <div class="min-w-0">
                    <label
                        for="beta-features-switch"
                        class="type-body font-medium text-foreground"
                    >
                        Show beta tools
                    </label>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Reveal developer and feature-testing areas that may change without notice.
                    </p>
                </div>
                <Switch
                    bind:checked={settings.showBetaFeatures}
                    id="beta-features-switch"
                    class="shrink-0"
                />
            </div>
        </div>
    </Page.Section>

    <Page.Section
        title="Developer"
        description="Inspect what ProblemCloud is doing under the hood on this device."
    >
        <div class="border-y border-border/60">
            <div class="flex items-center justify-between gap-6 py-4">
                <div class="min-w-0">
                    <label for="debug-mode-switch" class="type-body font-medium text-foreground">
                        Debug mode
                    </label>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Offer debug controls where they exist — the trainer's problem and rating
                        panel, and a switch in the Coach that reveals the system prompt and the
                        context sent with each message. Each one still has its own toggle.
                    </p>
                </div>
                <Switch
                    bind:checked={settings.debugMode}
                    id="debug-mode-switch"
                    class="shrink-0"
                />
            </div>
        </div>
    </Page.Section>

    <Page.Section
        title="Account"
        description="Details associated with your current ProblemCloud account."
    >
        {#if session && profile}
            <dl class="border-y border-border/60 divide-y divide-border/60">
                <div class="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt class="type-secondary text-muted-foreground">Username</dt>
                    <dd class="type-body text-foreground sm:text-right">
                        {profile.username || "Not set"}
                    </dd>
                </div>
                <div class="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt class="type-secondary text-muted-foreground">Email address</dt>
                    <dd class="type-body break-words text-foreground sm:text-right">
                        {session.user?.email || "Not set"}
                    </dd>
                </div>
                <div class="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt class="type-secondary text-muted-foreground">Account role</dt>
                    <dd class="type-body text-foreground sm:text-right">
                        {profile.admin_rank > 0
                            ? `Admin (level ${profile.admin_rank})`
                            : "Standard user"}
                    </dd>
                </div>
                <div class="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt class="type-secondary text-muted-foreground">Status</dt>
                    <dd class="type-body text-foreground sm:text-right">
                        {profile.status || "None"}
                    </dd>
                </div>
            </dl>
        {:else}
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div>
                    <p class="type-body font-medium text-foreground">You are not logged in</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Log in to view your account details and connected services.
                    </p>
                </div>
                <Button href="/auth/login" variant="primary" class="shrink-0">Log in</Button>
            </div>
        {/if}
    </Page.Section>

    {#if session && user}
        <AIConnectionsSection />

        <Page.Section
            title="Feedback"
            description="Report a bug, suggest a feature, or share an idea with the team."
        >
            <div
                class="flex flex-col gap-4 border-y border-border/60 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
                <div>
                    <p class="type-body font-medium text-foreground">Send feedback</p>
                    <p class="mt-0.5 type-secondary text-muted-foreground">
                        Your message goes directly to the ProblemCloud team for review.
                    </p>
                </div>
                <Button onclick={openFeedback} variant="outline" class="shrink-0">
                    <Icon name="send" fontsize="1.1rem" />
                    Send feedback
                </Button>
            </div>
        </Page.Section>
    {/if}
</Page.Root>
