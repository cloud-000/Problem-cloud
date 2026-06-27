<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Problem } from "$lib/components/problem";
    import { StatusTag } from "$lib/components/status-tag";
    import type { PracticeSessionRow } from "$lib/sessions";
    import {
        fetchSessionSubmissions,
        type RecentSubmissionRow,
    } from "$lib/progress";

    let {
        session,
        supabase,
        busy = false,
        onContinue,
        onRename,
        onDelete,
    }: {
        session: PracticeSessionRow;
        supabase: SupabaseClient<Database>;
        busy?: boolean;
        onContinue: () => void;
        onRename: (name: string) => void;
        onDelete: () => void;
    } = $props();

    // Self-contained per-card UI state.
    let expanded = $state(false);
    let submissions = $state<RecentSubmissionRow[] | null | undefined>(
        undefined,
    );
    let editing = $state(false);
    let editName = $state("");
    let menuOpen = $state(false);

    function beginRename() {
        editName = session.name ?? "";
        editing = true;
    }

    function saveRename() {
        editing = false;
        onRename(editName.trim());
    }

    async function toggleExpand() {
        if (expanded) {
            expanded = false;
            return;
        }
        expanded = true;
        if (submissions === undefined) {
            submissions = null; // mark loading
            try {
                submissions = await fetchSessionSubmissions(
                    supabase,
                    session.id,
                );
            } catch {
                submissions = [];
            }
        }
    }

    function accuracy(s: PracticeSessionRow): string {
        if (s.times_reviewed === 0) return "—";
        return `${Math.round((s.times_correct / s.times_reviewed) * 100)}%`;
    }

    function formatTime(ms: number): string {
        const totalSec = Math.floor(ms / 1000);
        const hrs = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        if (hrs > 0) return `${hrs}h ${mins}m`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    }

    function formatDate(iso: string): string {
        return new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });
    }
</script>

<div
    class="rounded-xl border border-border/60 bg-surface-container-lowest transition-all duration-200 shadow-xs hover:border-border"
>
    <!-- Session summary row -->
    {#if editing}
        <div class="flex items-center gap-2 p-4">
            <!-- svelte-ignore a11y_autofocus -->
            <input
                class="flex-1 min-w-0 rounded-md border border-border/60 bg-surface-container-low px-3 py-1.5 text-sm outline-none focus:border-primary"
                placeholder="Session name"
                bind:value={editName}
                autofocus
                onkeydown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") editing = false;
                }}
            />
            <Button
                size="sm"
                onclick={saveRename}
                class="bg-primary text-primary-foreground hover:bg-primary/95"
            >
                Save
            </Button>
            <Button size="sm" variant="ghost" onclick={() => (editing = false)}>
                Cancel
            </Button>
        </div>
    {:else}
        <div class="flex items-center gap-2 p-4">
            <!-- Status that morphs into Continue/Resume on hover -->
            <StatusTag
                class="shrink-0"
                status={session.status === "active" ? "active" : "ended"}
                disabled={busy}
                action={{
                    label: session.status === "active" ? "Continue" : "Resume",
                    icon:
                        session.status === "active"
                            ? "play_arrow"
                            : "restart_alt",
                    onclick: onContinue,
                }}
            />

            <button
                type="button"
                onclick={toggleExpand}
                class="flex items-center gap-3 min-w-0 flex-1 text-left outline-none cursor-pointer select-none"
            >
                <div class="flex flex-col min-w-0">
                    <span
                        class="text-sm font-semibold text-foreground truncate"
                    >
                        {session.name ?? "Untitled session"}
                    </span>
                    <span class="text-xs text-muted-foreground mt-0.5">
                        {formatDate(session.started_at)}
                    </span>
                </div>
            </button>

            <div class="flex items-center gap-2 shrink-0">
                <span
                    class="hidden sm:inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1 text-xs font-mono text-muted-foreground"
                >
                    {session.times_seen} attempts
                </span>
                <span
                    class="hidden sm:inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1 text-xs font-mono text-muted-foreground"
                >
                    {accuracy(session)}
                </span>
                <span
                    class="hidden md:inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1 text-xs font-mono text-muted-foreground"
                >
                    {formatTime(session.total_time_ms)}
                </span>

                <!-- More actions (rename / delete) -->
                <div class="relative">
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onclick={() => (menuOpen = !menuOpen)}
                    >
                        <Icon
                            name="more_vert"
                            class="size-[1.1em] leading-none"
                        />
                    </Button>
                    {#if menuOpen}
                        <!-- Outside-click backdrop -->
                        <button
                            type="button"
                            tabindex="-1"
                            aria-label="Close menu"
                            class="fixed inset-0 z-20 cursor-default"
                            onclick={() => (menuOpen = false)}
                        ></button>
                        <div
                            role="menu"
                            class="absolute right-0 top-8 z-30 flex w-40 flex-col gap-0.5 rounded-lg border border-border bg-surface-container-highest p-1 shadow-lg"
                        >
                            <button
                                type="button"
                                role="menuitem"
                                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                                onclick={() => {
                                    menuOpen = false;
                                    beginRename();
                                }}
                            >
                                <Icon
                                    name="edit"
                                    class="size-[1.1em] text-muted-foreground"
                                />
                                Rename
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
                                onclick={() => {
                                    menuOpen = false;
                                    onDelete();
                                }}
                            >
                                <Icon name="delete" class="size-[1.1em]" />
                                Delete
                            </button>
                        </div>
                    {/if}
                </div>

                <button
                    type="button"
                    onclick={toggleExpand}
                    aria-label={expanded ? "Collapse" : "Expand"}
                    class="inline-flex items-center text-muted-foreground"
                >
                    <Icon
                        name={expanded ? "expand_less" : "expand_more"}
                        class="transition-transform duration-200"
                    />
                </button>
            </div>
        </div>
    {/if}

    <!-- Expanded: session submissions -->
    {#if expanded}
        <div
            class="border-t border-border/40 p-4 bg-surface-container-low/10 space-y-3 rounded-b-xl"
        >
            <!-- Stat chips (always visible on small screens too) -->
            <div
                class="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground sm:hidden"
            >
                <span
                    class="inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1"
                    >{session.times_seen} attempts</span
                >
                <span
                    class="inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1"
                    >{accuracy(session)} acc</span
                >
                <span
                    class="inline-flex items-center rounded-md bg-surface-container-low px-2.5 py-1"
                    >{formatTime(session.total_time_ms)}</span
                >
            </div>

            {#if submissions === null || submissions === undefined}
                <div
                    class="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground"
                >
                    <Icon name="progress_activity" class="animate-spin" />
                    Loading submissions...
                </div>
            {:else if submissions.length === 0}
                <p
                    class="text-xs text-muted-foreground italic py-4 text-center"
                >
                    No submissions recorded in this session.
                </p>
            {:else}
                <div class="space-y-2">
                    {#each submissions as sub (sub.id)}
                        <div
                            class="rounded-lg border border-border/50 bg-surface-container-lowest p-4"
                        >
                            <div class="flex items-center gap-2 mb-3 text-xs">
                                <StatusTag
                                    size="sm"
                                    status={sub.skipped
                                        ? "skipped"
                                        : sub.is_correct
                                          ? "correct"
                                          : "incorrect"}
                                />
                                {#if sub.flagged}
                                    <Icon
                                        name="flag"
                                        class="text-unsure size-[1.1em]"
                                        fill
                                    />
                                {/if}
                            </div>
                            {#if sub.problems}
                                <Problem
                                    problem={sub.problems}
                                    selectedChoice={sub.selected_choice}
                                    showAnswerState={true}
                                    disabled={true}
                                    mode="preview"
                                />
                            {:else}
                                <p class="text-xs text-muted-foreground italic">
                                    Problem details could not be loaded.
                                </p>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>
