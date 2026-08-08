<script lang="ts">
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ProblemReview } from "$lib/components/problem";
    import { StatusTag } from "$lib/components/status-tag";
    import type { PracticeSessionRow } from "$lib/sessions";
    import { DropdownMenu, type DropdownOption } from "$lib/components/dropdown-menu/index.js";
    import {
        fetchSessionSubmissions,
        type RecentSubmissionRow,
    } from "$lib/progress";

    let {
        session,
        supabase,
        busy = false,
        featured = false,
        onContinue,
        onRename,
        onDelete,
    }: {
        session: PracticeSessionRow;
        supabase: SupabaseClient<Database>;
        busy?: boolean;
        featured?: boolean;
        onContinue: () => void;
        onRename: (name: string) => void;
        onDelete: () => void;
    } = $props();

    // Session format from the settings snapshot (older sessions predate it).
    const isTest = $derived(
        (session.settings as { format?: string } | null)?.format === "test",
    );

    // Self-contained per-card UI state.
    let expanded = $state(false);
    let submissions = $state<RecentSubmissionRow[] | null | undefined>(
        undefined,
    );
    let editing = $state(false);
    let editName = $state("");

    const menuOptions = $derived<DropdownOption[]>([
        {
            label: "Rename",
            icon: "edit",
            onclick: () => beginRename(),
        },
        {
            label: "Delete",
            icon: "delete",
            color: "var(--destructive)",
            onclick: () => onDelete(),
        },
    ]);

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

<div class={featured ? "bg-surface-container-low" : "border-b border-border/60 last:border-b-0"}>
    <!-- Session summary row -->
    {#if editing}
        <div class="flex items-center gap-2 px-4 py-3">
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
                variant="primary"
                onclick={saveRename}
            >
                Save
            </Button>
            <Button size="sm" variant="ghost" onclick={() => (editing = false)}>
                Cancel
            </Button>
        </div>
    {:else}
        <div class="flex min-h-16 items-center gap-3 px-3 py-3 sm:px-4">
            <Button
                size={featured ? "sm" : "icon-sm"}
                variant={featured ? "primary" : "ghost"}
                disabled={busy}
                onclick={onContinue}
                aria-label={session.status === "active"
                    ? "Continue session"
                    : isTest
                      ? "View test results"
                      : "Resume session"}
                title={session.status === "active"
                    ? "Continue session"
                    : isTest
                      ? "View test results"
                      : "Resume session"}
                class="shrink-0 gap-1.5"
            >
                <Icon
                    name={session.status === "active"
                        ? "play_arrow"
                        : isTest
                          ? "visibility"
                          : "restart_alt"}
                    fontsize={24}
                />
                {#if featured}<span>Continue</span>{/if}
            </Button>

            <button
                type="button"
                onclick={toggleExpand}
                class="flex items-center gap-3 min-w-0 flex-1 text-left outline-none cursor-pointer select-none"
            >
                <div class="flex flex-col min-w-0">
                    <span class="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <span class="truncate">
                            {session.name ?? "Untitled session"}
                        </span>
                        {#if isTest}
                            <span
                            class="type-caption inline-flex shrink-0 items-center gap-1 text-muted-foreground"
                            >
                                <Icon name="quiz" class="size-[1em]" />
                                Test
                            </span>
                        {/if}
                    </span>
                    <span class="type-caption mt-0.5 text-muted-foreground">
                        {formatDate(session.started_at)}
                    </span>
                </div>
            </button>

            <div class="flex items-center gap-2 shrink-0">
                <span class="hidden type-caption font-mono text-muted-foreground sm:inline">
                    {session.times_seen} attempts
                </span>
                <span class="hidden type-caption font-mono text-muted-foreground sm:inline">
                    {accuracy(session)}
                </span>
                <span class="hidden type-caption font-mono text-muted-foreground md:inline">
                    {formatTime(session.total_time_ms)}
                </span>

                <!-- More actions (rename / delete) -->
                <DropdownMenu options={menuOptions}>
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="More actions"
                        class="cursor-pointer"
                    >
                        <Icon
                            name="more_vert"
                            class="size-[1.1em] leading-none"
                        />
                    </Button>
                </DropdownMenu>

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
            class="space-y-4 border-t border-border/60 px-4 py-5"
        >
            <!-- Stat chips (always visible on small screens too) -->
            <div
                class="flex flex-wrap gap-x-4 gap-y-1 type-caption font-mono text-muted-foreground sm:hidden"
            >
                <span
                    class="inline-flex items-center"
                    >{session.times_seen} attempts</span
                >
                <span
                    class="inline-flex items-center"
                    >{accuracy(session)} acc</span
                >
                <span
                    class="inline-flex items-center"
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
                        {#if sub.problems}
                            <ProblemReview
                                entry={{
                                    problem: sub.problems,
                                    selectedChoice: sub.selected_choice,
                                    answer: sub.answer ?? "",
                                    correct: sub.is_correct,
                                    flagged: sub.flagged,
                                    skipped: sub.skipped,
                                }}
                                autoRevealSolution={false}
                            />
                        {:else}
                            <div
                                class="rounded-lg border border-border/50 bg-surface-container-lowest p-4"
                            >
                                <div
                                    class="flex items-center gap-2 mb-3 text-xs"
                                >
                                    <StatusTag
                                        size="sm"
                                        status={sub.skipped
                                            ? "skipped"
                                            : sub.is_correct === null
                                              ? "ungraded"
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
                                <p class="text-xs text-muted-foreground italic">
                                    Problem details could not be loaded.
                                </p>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</div>
