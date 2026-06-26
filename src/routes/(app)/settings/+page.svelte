<script lang="ts">
    import { Select } from "$lib/components/select";
    import { Icon } from "$lib/components/icon";
    import { Theme } from "$lib/utils/Theme.svelte";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();
    let { profile, session } = $derived(data);
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="settings"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            Settings
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Customize your ProblemCloud experience and manage your preferences.
        </p>
    </div>

    <!-- Interface Settings -->
    <div
        class="border border-border/50 rounded-xl p-6 bg-surface-container-lowest shadow-xs flex flex-col gap-6"
    >
        <div>
            <h2
                class="text-lg font-semibold text-foreground flex items-center gap-2"
            >
                <Icon name="palette" class="text-primary-foreground" />
                Appearance
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Change the interface theme. Asymptote diagrams will adjust
                contrast automatically.
            </p>
        </div>

        <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2"
        >
            <div class="flex flex-col gap-0.5">
                <span class="text-sm font-medium text-foreground">Theme</span>
                <span class="text-xs text-muted-foreground"
                    >Select a light or dark aesthetic.</span
                >
            </div>
            <div class="w-full sm:w-56 shrink-0">
                <Select
                    value={Theme.theme}
                    options={Theme.themeOptions}
                    onchange={(val) => {
                        Theme.theme = val;
                    }}
                />
            </div>
        </div>
    </div>

    <!-- Account Details -->
    <div
        class="border border-border/50 rounded-xl p-6 bg-surface-container-lowest shadow-xs flex flex-col gap-6"
    >
        <div>
            <h2
                class="text-lg font-semibold text-foreground flex items-center gap-2"
            >
                <Icon name="account_circle" class="text-primary-foreground" />
                Account Profile
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Information about your current logged-in account.
            </p>
        </div>

        {#if session && profile}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div
                    class="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low/40 border border-border/30"
                >
                    <span
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                        >Username</span
                    >
                    <span class="text-sm font-medium text-foreground"
                        >{profile.username || "Not set"}</span
                    >
                </div>

                <div
                    class="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low/40 border border-border/30"
                >
                    <span
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                        >Email Address</span
                    >
                    <span class="text-sm font-medium text-foreground"
                        >{session.user?.email || "Not set"}</span
                    >
                </div>

                <div
                    class="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low/40 border border-border/30"
                >
                    <span
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                        >Rank Status</span
                    >
                    <span class="text-sm font-medium text-foreground">
                        {profile.admin_rank > 0
                            ? `Admin (Level ${profile.admin_rank})`
                            : "Standard User"}
                    </span>
                </div>

                <div
                    class="flex flex-col gap-1 p-3 rounded-lg bg-surface-container-low/40 border border-border/30"
                >
                    <span
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                        >Bio Status</span
                    >
                    <span class="text-sm font-medium text-foreground"
                        >{profile.status || "None"}</span
                    >
                </div>
            </div>
        {:else}
            <div
                class="flex flex-col items-center justify-center p-8 rounded-lg border border-dashed border-border/80 bg-surface-container-low/20"
            >
                <Icon
                    name="error_outline"
                    fontsize="3rem"
                    class="text-muted-foreground mb-2"
                />
                <span class="text-sm font-medium text-foreground"
                    >Not Logged In</span
                >
                <span
                    class="text-xs text-muted-foreground mt-1 mb-4 text-center"
                >
                    Please log in to view and manage your profile details.
                </span>
                <a
                    href="/auth/login"
                    class="inline-flex items-center justify-center h-9 rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium transition-colors hover:bg-primary/95 shadow-xs"
                >
                    Log In
                </a>
            </div>
        {/if}
    </div>
</div>
