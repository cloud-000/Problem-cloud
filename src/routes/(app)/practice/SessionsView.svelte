<script lang="ts">
    import type { PageData } from "./$types";
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Modal } from "$lib/components/modal";
    import { RangeSlider } from "$lib/components/range-slider";
    import { Select, type SelectOption } from "$lib/components/select";
    import { Switch } from "$lib/components/toggle";
    import { fetchAllTests } from "$lib/library";
    import {
        fetchSessions,
        startSession,
        renameSession,
        deleteSession,
        resumeSession,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import {
        defaultPracticeSettings,
        defaultTestSettings,
    } from "$lib/trainer";
    import { cn } from "$lib/utils";
    import SessionCard from "./SessionCard.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let sessions = $state<PracticeSessionRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    let busy = $state(false);

    // ---- New-session dialog ----------------------------------------------------
    type TestOption = Awaited<ReturnType<typeof fetchAllTests>>[number];

    const TIME_MIN = 5; // slider bounds, in minutes
    const TIME_MAX = 240;
    const DEFAULT_TIME_MIN = 75;

    let dialogOpen = $state(false);
    let dialogName = $state("");
    let dialogFormat = $state<"practice" | "test">("practice");
    let tests = $state<TestOption[]>([]);
    let testsLoading = $state(false);
    let selectedTestId = $state<string>(""); // stringified id for <Select>
    let timeMinutes = $state(DEFAULT_TIME_MIN);
    let unlimited = $state(false);

    let testOptions = $derived<SelectOption[]>(
        tests.map((t) => ({
            value: String(t.id),
            label: t.year ? `${t.name} (${t.year})` : t.name,
        })),
    );
    let canCreate = $derived(
        dialogFormat === "practice" || selectedTestId !== "",
    );

    function openDialog() {
        if (!user || busy) return;
        dialogName = "";
        dialogFormat = "practice";
        selectedTestId = "";
        timeMinutes = DEFAULT_TIME_MIN;
        unlimited = false;
        dialogOpen = true;
        if (tests.length === 0) loadTests();
    }

    async function loadTests() {
        testsLoading = true;
        try {
            tests = await fetchAllTests(supabase);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load tests";
        } finally {
            testsLoading = false;
        }
    }

    // Seed the time control from the chosen test's default allotment.
    function onTestChange(value: string) {
        selectedTestId = value;
        const test = tests.find((t) => String(t.id) === value);
        if (test?.time_limit_seconds != null) {
            unlimited = false;
            timeMinutes = Math.min(
                TIME_MAX,
                Math.max(TIME_MIN, Math.round(test.time_limit_seconds / 60)),
            );
        } else if (test) {
            unlimited = true;
        }
    }

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

    async function confirmCreate() {
        if (!user || busy || !canCreate) return;
        busy = true;
        try {
            const name = dialogName.trim() || null;
            let settings = defaultPracticeSettings();
            if (dialogFormat === "test") {
                const testId = Number(selectedTestId);
                const timeLimitSeconds = unlimited ? null : timeMinutes * 60;
                settings = defaultTestSettings(testId, timeLimitSeconds);
            }
            const row = await startSession(supabase, user.id, {
                name,
                settings,
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

    function sessionFormat(s: PracticeSessionRow): "practice" | "test" {
        const fmt = (s.settings as { format?: string } | null)?.format;
        return fmt === "test" ? "test" : "practice";
    }

    async function openSession(s: PracticeSessionRow) {
        if (busy) return;
        // Ended *practice* sessions are reopened so new work appends to them. An
        // ended test is final (submitted) — open it read-only to show results.
        if (s.status === "ended" && sessionFormat(s) !== "test") {
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
                    onclick={openDialog}
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
                <Button size="sm" onclick={openDialog} disabled={busy}>
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

<!-- New-session dialog -->
<Modal
    bind:open={dialogOpen}
    title="Start a new session"
    size="sm"
    class="flex flex-col gap-5"
>
    <!-- Name -->
    <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground"
            >Name (optional)</span
        >
        <Input bind:value={dialogName} placeholder="e.g. Friday drill" />
    </div>

    <!-- Format -->
    <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">Format</span>
        <div
            class="flex items-center gap-1 rounded-lg border border-border/60 bg-surface-container-low p-1"
            role="radiogroup"
            aria-label="Session format"
        >
            {#each [{ value: "practice", label: "Practice" }, { value: "test", label: "Test" }] as f (f.value)}
                <button
                    type="button"
                    role="radio"
                    aria-checked={dialogFormat === f.value}
                    onclick={() =>
                        (dialogFormat = f.value as "practice" | "test")}
                    class={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        dialogFormat === f.value
                            ? "bg-surface-container-lowest text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {f.label}
                </button>
            {/each}
        </div>
        <p class="text-[10px] text-muted-foreground">
            {dialogFormat === "test"
                ? "Work a whole test; grading is held until you submit."
                : "Free practice with immediate feedback."}
        </p>
    </div>

    <!-- Test options -->
    {#if dialogFormat === "test"}
        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">Test</span>
            {#if testsLoading}
                <div
                    class="flex items-center gap-2 text-xs text-muted-foreground py-2"
                >
                    <Icon name="progress_activity" class="animate-spin" />
                    Loading tests...
                </div>
            {:else}
                <Select
                    options={testOptions}
                    value={selectedTestId}
                    placeholder="Choose a test"
                    onchange={onTestChange}
                />
            {/if}
        </div>

        <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-muted-foreground"
                    >Unlimited time</span
                >
                <span class="text-[10px] text-muted-foreground">
                    {unlimited ? "No time limit" : "Timed"}
                </span>
            </div>
            <Switch bind:checked={unlimited} size="sm" />
        </div>

        {#if !unlimited}
            <div class="flex flex-col gap-2">
                <span class="text-xs font-medium text-muted-foreground">
                    Time limit ({timeMinutes} min)
                </span>
                <RangeSlider
                    single
                    bind:singleValue={timeMinutes}
                    min={TIME_MIN}
                    max={TIME_MAX}
                    step={5}
                    label="Time limit"
                    formatValue={(v) => `${v}m`}
                />
            </div>
        {/if}
    {/if}

    {#snippet footer()}
        <Button variant="ghost" size="sm" onclick={() => (dialogOpen = false)}>
            Cancel
        </Button>
        <Button
            size="sm"
            onclick={confirmCreate}
            disabled={busy || !canCreate}
            class="bg-primary text-primary-foreground hover:bg-primary/95"
        >
            Start
        </Button>
    {/snippet}
</Modal>
