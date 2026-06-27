<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        fetchSessions,
        startSession,
        renameSession,
        deleteSession,
        resumeSession,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import { defaultPracticeSettings } from "$lib/trainer";
    import SessionCard from "./SessionCard.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let sessions = $state<PracticeSessionRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    let busy = $state(false);

    async function loadSessions() {
        if (!user) {
            loading = false;
            return;
        }
        loading = true;
        try {
            sessions = await fetchSessions(supabase);
            errorMsg = null;
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load sessions";
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        loadSessions();
    });

    async function startNew() {
        if (!user || busy) return;
        const name = window.prompt("Name this session (optional):")?.trim();
        if (name === undefined) return; // cancelled
        busy = true;
        try {
            const row = await startSession(supabase, user.id, {
                name: name || null,
                settings: defaultPracticeSettings(),
            });
            await goto(`/practice?session=${row.id}`);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to start session";
            busy = false;
        }
    }

    function practiceFreely() {
        goto("/practice?session=root");
    }

    async function openSession(s: PracticeSessionRow) {
        if (busy) return;
        // Ended sessions are reopened so new work appends to them.
        if (s.status === "ended") {
            busy = true;
            try {
                await resumeSession(supabase, s.id);
            } catch (e) {
                errorMsg = (e as Error).message || "Failed to resume session";
                busy = false;
                return;
            }
        }
        await goto(`/practice?session=${s.id}`);
    }

    async function saveRename(s: PracticeSessionRow, name: string) {
        try {
            await renameSession(supabase, s.id, name);
            sessions = sessions.map((row) =>
                row.id === s.id ? { ...row, name: name || null } : row,
            );
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to rename session";
        }
    }

    async function removeSession(s: PracticeSessionRow) {
        if (
            !window.confirm(
                "Delete this session? Its problems stay in your history (they return to ungrouped).",
            )
        )
            return;
        try {
            await deleteSession(supabase, s.id);
            sessions = sessions.filter((row) => row.id !== s.id);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to delete session";
        }
    }
</script>

<div class="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
    <!-- Header -->
    <div
        class="border-b border-border/80 pb-4 flex flex-wrap items-end justify-between gap-4"
    >
        <div class="space-y-1">
            <h1
                class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
            >
                <Icon
                    name="stacks"
                    fontsize="2rem"
                    class="text-primary-foreground"
                />
                Train
            </h1>
            <p class="text-sm text-muted-foreground">
                Start a focused session to group your practice, or practice
                freely without one.
            </p>
        </div>
        {#if user}
            <div class="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    onclick={practiceFreely}
                >
                    <Icon name="bolt" class="size-[1.1em]" />
                    Practice freely
                </Button>
                <Button
                    size="sm"
                    class="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/95 shadow-sm"
                    onclick={startNew}
                    disabled={busy}
                >
                    <Icon name="add" class="size-[1.1em]" />
                    Start new session
                </Button>
            </div>
        {/if}
    </div>

    {#if !user}
        <div
            class="flex flex-col items-center justify-center gap-4 text-center py-16"
        >
            <div
                class="flex size-16 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="stacks" fontsize="2.5rem" />
            </div>
            <div class="flex max-w-sm flex-col gap-1">
                <h2 class="text-lg font-semibold">
                    Sign in to practice and track sessions
                </h2>
                <p class="text-sm text-muted-foreground">
                    Sessions group a run of practice with their own settings and
                    stats.
                </p>
            </div>
            <div class="flex items-center gap-2 mt-2">
                <Button
                    variant="outline"
                    onclick={practiceFreely}
                    class="px-6"
                >
                    Practice freely
                </Button>
                <Button
                    href="/auth/login"
                    class="bg-primary text-primary-foreground hover:bg-primary/95 px-6 shadow-sm"
                >
                    Log In
                </Button>
            </div>
        </div>
    {:else if loading && sessions.length === 0}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
            <Icon
                name="progress_activity"
                class="animate-spin text-muted-foreground"
                fontsize="1.8rem"
            />
            <p class="text-xs text-muted-foreground">Loading sessions...</p>
        </div>
    {:else if errorMsg}
        <div
            class="p-4 rounded-lg bg-destructive/10 text-destructive text-sm text-center"
        >
            {errorMsg}
        </div>
    {:else if sessions.length === 0}
        <div
            class="flex flex-col items-center justify-center py-16 gap-3 text-center"
        >
            <div
                class="flex size-12 items-center justify-center rounded-full bg-surface-container text-muted-foreground"
            >
                <Icon name="stacks" fontsize="1.8rem" />
            </div>
            <div>
                <h3 class="text-sm font-semibold">No sessions yet</h3>
                <p class="text-xs text-muted-foreground mt-0.5">
                    Start a session to group your practice, or jump straight in.
                </p>
            </div>
            <div class="flex items-center gap-2 mt-1">
                <Button size="sm" variant="outline" onclick={practiceFreely}>
                    Practice freely
                </Button>
                <Button size="sm" onclick={startNew} disabled={busy}>
                    Start new session
                </Button>
            </div>
        </div>
    {:else}
        <div class="space-y-2">
            {#each sessions as s (s.id)}
                <SessionCard
                    session={s}
                    {supabase}
                    {busy}
                    onContinue={() => openSession(s)}
                    onRename={(name) => saveRename(s, name)}
                    onDelete={() => removeSession(s)}
                />
            {/each}
        </div>
    {/if}
</div>
