<script lang="ts">
    import type { PageData } from "./$types";
    import { afterNavigate, goto, replaceState } from "$app/navigation";
    import { resolve } from "$app/paths";
    import { page } from "$app/state";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { Modal } from "$lib/components/modal";
    import { modal } from "$lib/state/modal.svelte";
    import * as Page from "$lib/components/page";
    import { RangeSlider } from "$lib/components/range-slider";
    import { Select, type SelectOption } from "$lib/components/select";
    import { Switch } from "$lib/components/toggle";
    import { fetchAllSeries, fetchTestsForSeries, type TestSummary } from "$lib/library";
    import {
        fetchSessions,
        startSession,
        renameSession,
        deleteSession,
        resumeSession,
        type PracticeSessionRow,
    } from "$lib/sessions";
    import {
        resolveTimingRule,
        timingPacing,
        timingSummary,
        timingTotalSeconds,
        type Pacing,
        type TimingRule,
    } from "$lib/test-timing";
    import {
        defaultPracticeSettings,
        defaultTestSettings,
        type PracticeSettings,
    } from "$lib/trainer";
    import {
        parsePracticeLaunch,
        type PracticeLaunchIntent,
    } from "$lib/practice-launch";
    import { cn } from "$lib/utils";
    import { onMount } from "svelte";
    import SessionCard from "./SessionCard.svelte";
    import Track from "./Track.svelte";
    import { createTrackValue, type TrackValue } from "./practice-settings";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);

    let sessions = $state<PracticeSessionRow[]>([]);
    let loading = $state(true);
    let errorMsg = $state<string | null>(null);
    let busy = $state(false);
    let activeSession = $derived(
        sessions.find((session) => session.status === "active") ?? null,
    );
    let savedSessions = $derived(
        activeSession
            ? sessions.filter((session) => session.id !== activeSession.id)
            : sessions,
    );

    // ---- New-session dialog ----------------------------------------------------
    type SeriesOption = Awaited<ReturnType<typeof fetchAllSeries>>[number];

    let dialogOpen = $state(false);
    let dialogName = $state("");
    let dialogFormat = $state<"practice" | "test">("practice");
    let series = $state<SeriesOption[]>([]);
    let tests = $state<TestSummary[]>([]);
    let testsLoading = $state(false);
    let selectedSeriesId = $state<string>(""); // stringified id for <Select>
    let selectedTestId = $state<string>("");
    // Slider value in the resolved rule's unit (min/pair, sec/problem, or total min).
    let unitValue = $state(0);
    let unlimited = $state(false);
    // Segmented pacing only: strict expiry hard-locks + auto-advances each segment
    // at 0:00; lenient lets the clock run red and overrun until the user submits.
    let strictTiming = $state(true);
    // Test-format opt-ins (both default off, matching a real mock). `allowPause`
    // restores the pausable clock; `revealPerSegment` grades + reveals each
    // Countdown problem the moment its segment is submitted.
    let allowPause = $state(false);
    let revealPerSegment = $state(false);
    // Practice-format track (topic/series/division-format), front-loaded in the
    // dialog. Optional: an empty selection means "any" (today's default), so it
    // never gates `canCreate`. Shared with SettingsPanel's mid-session Track.
    let track = $state<TrackValue>(createTrackValue());

    // Typed narrower than `SelectOption[]` (no bare-string variant) so this same
    // array can feed both the test-format `<Select>` below and the practice-format
    // `<Track>`, which needs the `{ value; label }` object shape.
    let seriesOptions = $derived<{ value: string; label: string }[]>(
        series.map((s) => ({ value: String(s.id), label: s.name })),
    );
    // Tests scoped to the chosen series, newest first (fetch order preserved).
    let seriesTests = $derived(
        selectedSeriesId === ""
            ? []
            : tests.filter((t) => String(t.series_id) === selectedSeriesId),
    );
    let testOptions = $derived<SelectOption[]>(
        seriesTests.map((t) => ({
            value: String(t.id),
            label: t.year ? `${t.name} (${t.year})` : t.name,
        })),
    );
    let selectedTest = $derived(
        tests.find((t) => String(t.id) === selectedTestId) ?? null,
    );
    let selectedSeriesName = $derived(
        series.find((s) => String(s.id) === selectedSeriesId)?.name ?? null,
    );
    // The active timing rule for the chosen test — drives the slider's unit,
    // bounds, and label. Null until a test is picked.
    let rule = $derived<TimingRule | null>(
        selectedTest
            ? resolveTimingRule({
                  seriesName: selectedSeriesName,
                  format: selectedTest.format,
                  problemCount: selectedTest.problemCount,
                  dbTimeLimitSeconds: selectedTest.time_limit_seconds,
              })
            : null,
    );
    // Reads the reactive `rule`, so it re-runs when the slider unit changes.
    function sliderFormat(v: number): string {
        return rule?.mode === "per-problem-seconds" ? `${v}s` : `${v}m`;
    }
    // Segmented rules (Target pairs / Countdown problems) pace the test in
    // independently-timed segments, which is where strict/lenient timing applies.
    let isSegmentedRule = $derived(
        rule?.mode === "per-pair-minutes" || rule?.mode === "per-problem-seconds",
    );
    // Countdown (single-problem segments) is the only pacing where per-segment
    // reveal makes sense — a pair or a pooled clock reveals nothing mid-run.
    let isCountdownRule = $derived(rule?.mode === "per-problem-seconds");
    let canCreate = $derived(
        dialogFormat === "practice" ||
            (selectedSeriesId !== "" && selectedTestId !== ""),
    );

    function resetDialog(format: "practice" | "test" = "practice") {
        dialogName = "";
        dialogFormat = format;
        selectedSeriesId = "";
        selectedTestId = "";
        tests = [];
        unitValue = 0;
        unlimited = false;
        strictTiming = true;
        allowPause = false;
        revealPerSegment = false;
        track = createTrackValue();
    }

    function openDialog(format: "practice" | "test" = "practice") {
        if (!user || busy) return;
        resetDialog(format);
        dialogOpen = true;
        if (series.length === 0) loadSeries();
    }

    async function loadSeries() {
        try {
            series = await fetchAllSeries(supabase);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load series";
        }
    }

    async function onSeriesChange(value: string) {
        selectedSeriesId = value;
        selectedTestId = "";
        tests = [];
        if (!value) return;
        testsLoading = true;
        try {
            tests = await fetchTestsForSeries(supabase, value);
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to load tests";
        } finally {
            testsLoading = false;
        }
    }

    // Seed the time slider from the chosen test's timing rule.
    function onTestChange(value: string) {
        selectedTestId = value;
        const test = tests.find((t) => String(t.id) === value);
        if (!test) return;
        unlimited = false;
        unitValue = resolveTimingRule({
            seriesName: selectedSeriesName,
            format: test.format,
            problemCount: test.problemCount,
            dbTimeLimitSeconds: test.time_limit_seconds,
        }).unitDefault;
    }

    async function applyLaunchIntent(intent: PracticeLaunchIntent) {
        if (!user || busy) return;
        switch (intent.kind) {
            case "mock-test":
                resetDialog("test");
                dialogOpen = true;
                if (series.length === 0) await loadSeries();
                await onSeriesChange(String(intent.seriesId));
                onTestChange(String(intent.testId));
                break;
        }
    }

    // Launch parameters are one-shot commands: consume them, immediately replace
    // the current history entry with a clean URL, then configure the modal through
    // the same selection handlers used by direct interaction.
    afterNavigate(() => {
        const parsed = parsePracticeLaunch(page.url);
        if (!parsed.hadLaunchParams) return;
        const cleanedRoute = parsed.cleanedUrl.search
            ? (`/practice${parsed.cleanedUrl.search}${parsed.cleanedUrl.hash}` as `/practice?${string}`)
            : parsed.cleanedUrl.hash
              ? (`/practice${parsed.cleanedUrl.hash}` as `/practice#${string}`)
              : "/practice";
        replaceState(
            resolve(cleanedRoute),
            page.state,
        );
        if (parsed.intent) void applyLaunchIntent(parsed.intent);
    });

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

    onMount(loadSessions);

    async function confirmCreate() {
        if (!user || busy || !canCreate) return;
        busy = true;
        try {
            let name = dialogName.trim() || null;
            let settings: PracticeSettings = {
                ...defaultPracticeSettings(),
                topic: track.topic,
                seriesIds: track.seriesIds,
                seriesScopes: track.seriesScopes,
            };
            if (dialogFormat === "test") {
                const testId = Number(selectedTestId);
                const timeLimitSeconds =
                    unlimited || !rule
                        ? null
                        : timingTotalSeconds(rule, unitValue);
                // Unlimited overrides segmentation (no per-segment clocks either).
                const pacing: Pacing =
                    unlimited || !rule
                        ? { kind: "pooled", totalSeconds: null }
                        : timingPacing(rule, unitValue);
                settings = defaultTestSettings(
                    testId,
                    timeLimitSeconds,
                    pacing,
                    strictTiming,
                    allowPause,
                    // Only Countdown (single-problem segments) honors per-segment
                    // reveal; force it off otherwise so a stale toggle can't leak.
                    pacing.kind === "segmented" && pacing.segmentSize === 1
                        ? revealPerSegment
                        : false,
                );
                if (!name && selectedTest) {
                    name = selectedTest.year
                        ? `${selectedTest.name} (${selectedTest.year})`
                        : selectedTest.name;
                }
            }
            const row = await startSession(supabase, user.id, {
                name,
                settings,
            });
            await goto(resolve(`/practice?session=${row.id}`));
        } catch (e) {
            errorMsg = (e as Error).message || "Failed to start session";
            busy = false;
        }
    }

    function practiceFreely() {
        goto(resolve("/practice?session=root"));
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
        await goto(resolve(`/practice?session=${s.id}`));
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
            !(await modal.confirm({
                title: "Delete session",
                message:
                    "Delete this session? Its problems stay in your history (they return to ungrouped).",
                confirmLabel: "Delete",
                confirmVariant: "destructive",
            }))
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

<Page.Root width="standard">
    <Page.Header
        title="Practice"
        description="Build skill with focused problems, review, or a timed mock test."
    />

    {#if !user}
        <div
            class="flex flex-col items-start gap-4 border-t border-border/60 py-10"
        >
            <div class="max-w-3xl">
                <h2 class="type-section-title">
                    Sign in to practice and track sessions
                </h2>
                <p class="mt-1 type-secondary text-muted-foreground">
                    Sessions group a run of practice with their own settings and
                    stats.
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <Button variant="outline" onclick={practiceFreely}>
                    Quick practice
                </Button>
                <Button href="/auth/login" variant="primary">
                    Log In
                </Button>
            </div>
        </div>
    {:else}
        {#if loading && sessions.length === 0}
            <div class="flex min-h-28 items-center gap-3 text-muted-foreground">
                <Icon name="progress_activity" class="animate-spin" />
                <p class="type-secondary">Loading sessions…</p>
            </div>
        {:else if errorMsg}
            <div class="border-l-2 border-destructive py-2 pl-4 text-sm text-destructive">
                <p>{errorMsg}</p>
                <Button variant="ghost" size="sm" class="mt-2" onclick={loadSessions}>
                    Retry
                </Button>
            </div>
        {:else}
            {#if activeSession}
                <Page.Section
                    title="Continue"
                    description="Pick up where you left off."
                >
                    <SessionCard
                        userId={user!.id}
                        session={activeSession}
                        {supabase}
                        {busy}
                        featured
                        onContinue={() => openSession(activeSession)}
                        onRename={(name) => saveRename(activeSession, name)}
                        onDelete={() => removeSession(activeSession)}
                    />
                </Page.Section>
            {/if}

            <Page.Section
                title="Quick practice"
                description="Start immediately with your current practice settings."
            >
                <div class="flex items-center justify-between gap-6 border-y border-border/60 py-4">
                    <p class="type-secondary text-muted-foreground">
                        Jump into an ungrouped problem session.
                    </p>
                    <Button
                        variant={activeSession ? "outline" : "primary"}
                        onclick={practiceFreely}
                        class="shrink-0 gap-1.5"
                    >
                        Start practice
                        <Icon name="arrow_forward" />
                    </Button>
                </div>
            </Page.Section>

            <Page.Section
                title="Saved sessions"
                description="Resume a practice session or review completed work."
            >
                {#if savedSessions.length === 0}
                    <p class="border-y border-border/60 py-5 type-secondary text-muted-foreground">
                        {activeSession
                            ? "No other saved sessions yet."
                            : "No saved sessions yet. Create one for a focused goal or topic."}
                    </p>
                {:else}
                    <div class="border-y border-border/60">
                        {#each savedSessions as session (session.id)}
                            <SessionCard
                                userId={user!.id}
                                {session}
                                {supabase}
                                {busy}
                                onContinue={() => openSession(session)}
                                onRename={(name) => saveRename(session, name)}
                                onDelete={() => removeSession(session)}
                            />
                        {/each}
                    </div>
                {/if}
            </Page.Section>

            <Page.Section title="Create a session">
                <div class="flex items-center justify-between gap-6 border-t border-border/60 pt-4">
                    <p class="type-secondary text-muted-foreground">
                        Save settings and progress under a named practice goal.
                    </p>
                    <Button
                        variant="outline"
                        onclick={() => openDialog("practice")}
                        disabled={busy}
                        class="shrink-0"
                    >
                        Create session
                    </Button>
                </div>
            </Page.Section>

            <Page.Section title="Take a mock test">
                <div class="flex items-center justify-between gap-6 border-t border-border/60 pt-4">
                    <p class="type-secondary text-muted-foreground">
                        Choose a test and configure its official pacing.
                    </p>
                    <Button
                        variant="ghost"
                        onclick={() => openDialog("test")}
                        disabled={busy}
                        class="shrink-0"
                    >
                        Choose test
                    </Button>
                </div>
            </Page.Section>
        {/if}
    {/if}
</Page.Root>

<!-- New-session dialog -->
<Modal
    bind:open={dialogOpen}
    title="Start a new session"
    size="md"
    class="flex flex-col min-h-120"
    overflowVisible={true}
>
    <div class="flex flex-col w-full h-full gap-2">
        <!-- Name -->
        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground"
                >Name (optional)</span
            >
            <Input bind:value={dialogName} placeholder="e.g. Friday drill" />
        </div>

        <!-- Format -->
        <div class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-muted-foreground">Format</span
            >
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
        </div>

        <!-- Practice options: what this session is about. Optional — an empty
             selection means "any" (today's default), same shared Track step as
             the mid-session settings panel. -->
        {#if dialogFormat === "practice"}
            <Track bind:value={track} {seriesOptions} {supabase} />
        {/if}

        <!-- Test options -->
        {#if dialogFormat === "test"}
            {#if testsLoading}
                <div
                    class="flex items-center gap-2 text-xs text-muted-foreground py-2"
                >
                    <Icon name="progress_activity" class="animate-spin" />
                    Loading tests...
                </div>
            {:else}
                <!-- Series -->
                <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Series</span
                    >
                    <Select
                        options={seriesOptions}
                        value={selectedSeriesId}
                        placeholder="Choose a series"
                        onchange={onSeriesChange}
                    />
                </div>

                <!-- Test -->
                <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Test</span
                    >
                    <Select
                        options={testOptions}
                        value={selectedTestId}
                        placeholder={selectedSeriesId === ""
                            ? "Select a series first"
                            : "Choose a test"}
                        disabled={selectedSeriesId === ""}
                        onchange={onTestChange}
                    />
                </div>
            {/if}

            <div class="flex items-center justify-between gap-3">
                <div class="flex flex-col gap-0">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Unlimited time</span
                    >
                    <span class="text-xxs text-muted-foreground">
                        {unlimited ? "No time limit" : "Timed"}
                    </span>
                </div>
                <Switch bind:checked={unlimited} size="sm" />
            </div>

            {#if !unlimited && rule}
                <div class="flex flex-col gap-2">
                    <span class="text-xs font-medium text-muted-foreground">
                        {rule.unitLabel} ({sliderFormat(unitValue)})
                    </span>
                    <RangeSlider
                        single
                        bind:singleValue={unitValue}
                        min={rule.unitMin}
                        max={rule.unitMax}
                        step={rule.unitStep}
                        label={rule.unitLabel}
                        formatValue={sliderFormat}
                    />
                    <p class="text-xxs text-muted-foreground">
                        {timingSummary(rule, unitValue)}
                    </p>
                </div>
            {/if}

            {#if !unlimited && isSegmentedRule}
                <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col gap-0">
                        <span class="text-xs font-medium text-muted-foreground"
                            >Strict timing</span
                        >
                        <span class="text-xxs text-muted-foreground">
                            {strictTiming
                                ? "Locks each segment at 0:00"
                                : "Timer turns red; you may overrun"}
                        </span>
                    </div>
                    <Switch bind:checked={strictTiming} size="sm" />
                </div>
            {/if}

            {#if !unlimited && isCountdownRule}
                <div class="flex items-center justify-between gap-3">
                    <div class="flex flex-col gap-0">
                        <span class="text-xs font-medium text-muted-foreground"
                            >Reveal after each problem</span
                        >
                        <span class="text-xxs text-muted-foreground">
                            {revealPerSegment
                                ? "Show the answer before the next problem"
                                : "Grade everything at the end"}
                        </span>
                    </div>
                    <Switch bind:checked={revealPerSegment} size="sm" />
                </div>
            {/if}

            <div class="flex items-center justify-between gap-3">
                <div class="flex flex-col gap-0">
                    <span class="text-xs font-medium text-muted-foreground"
                        >Allow pausing</span
                    >
                    {#if allowPause}
                        <span class="text-xxs text-muted-foreground">
                            You can pause the clock mid-test
                        </span>
                    {/if}
                </div>
                <Switch bind:checked={allowPause} size="sm" />
            </div>
        {/if}
    </div>
    {#snippet footer()}
        <Button variant="ghost" size="sm" onclick={() => (dialogOpen = false)}>
            Cancel
        </Button>
        <Button
            size="sm"
            variant="primary"
            onclick={confirmCreate}
            disabled={busy || !canCreate}
        >
            Start
        </Button>
    {/snippet}
</Modal>
