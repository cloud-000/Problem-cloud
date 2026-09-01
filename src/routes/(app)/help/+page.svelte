<script lang="ts">
    import { afterNavigate } from "$app/navigation";
    import { onMount, tick } from "svelte";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Modal } from "$lib/components/modal";
    import * as Page from "$lib/components/page";
    import {
        completeTourStep,
        completeWelcome,
        emptyOnboarding,
        fetchOnboarding,
        hasProductHistory,
        saveOnboarding,
        skipWelcome,
        startTour,
        tourWritesWelcomeState,
        type OnboardingState,
    } from "$lib/onboarding";
    import { fetchProblemStateSummary } from "$lib/progress";
    import type { PageData } from "./$types";
    import TourView from "../TourView.svelte";

    let { data }: { data: PageData } = $props();
    let { supabase, user } = $derived(data);
    let aiCoachEnabled = $derived(Boolean(data.aiCoachEnabled));

    let onboarding = $state<OnboardingState>(emptyOnboarding());
    let replayOpen = $state(false);
    let hasHistory = $state(false);

    const sectionLinkClass =
        "type-secondary text-muted-foreground transition-colors hover:text-foreground hover:underline";

    onMount(() => {
        if (!user) return;
        void Promise.all([
            fetchOnboarding(supabase, user.id).catch(() => emptyOnboarding()),
            fetchProblemStateSummary(supabase).catch(() => null),
        ]).then(([state, summary]) => {
            onboarding = state;
            hasHistory = hasProductHistory({
                attempted: summary?.attempted ?? 0,
                seen: summary?.seen ?? 0,
                sessionTimesSeen: 0,
            });
        });
    });

    function nowIso() {
        return new Date().toISOString();
    }

    async function persist(state: OnboardingState) {
        onboarding = state;
        if (!user) return;
        try {
            await saveOnboarding(supabase, user.id, state);
        } catch {
            // Replay persistence is best-effort.
        }
    }

    function openReplay() {
        replayOpen = true;
    }

    function scrollToHash(hash: string) {
        const id = decodeURIComponent(hash.replace(/^#/, ""));
        if (!id) return;
        document.getElementById(id)?.scrollIntoView({ block: "start" });
    }

    afterNavigate(async (navigation) => {
        const hash = navigation.to?.url.hash;
        if (!hash) return;
        await tick();
        scrollToHash(hash);
    });

    function closeReplay() {
        replayOpen = false;
    }

    function writesWelcome() {
        return tourWritesWelcomeState(onboarding.welcomeStatus, hasHistory);
    }

    function skipReplay() {
        if (writesWelcome()) {
            void persist(skipWelcome(onboarding, nowIso()));
        }
        replayOpen = false;
    }

    function advanceReplay(completedIndex: number) {
        if (!writesWelcome()) return;
        let nextState = onboarding;
        if (nextState.welcomeStatus === "unseen") {
            nextState = startTour(nextState, nowIso());
        }
        void persist(completeTourStep(nextState, completedIndex));
    }

    function finishReplay() {
        if (writesWelcome()) {
            void persist(completeWelcome(onboarding, nowIso()));
        }
        replayOpen = false;
    }
</script>

<svelte:window onhashchange={() => scrollToHash(window.location.hash)} />

<svelte:head><title>Help · ProblemCloud</title></svelte:head>

<Page.Root width="narrow" class="gap-10">
    <div class="flex flex-col gap-4">
        <Page.Header
            title="Help"
            description="What each part of ProblemCloud is for, and where to open it."
        />
        <nav aria-label="Help sections" class="flex flex-wrap gap-x-4 gap-y-1">
            <a href="#start" class={sectionLinkClass}>Quick start</a>
            <a href="#practice" class={sectionLinkClass}>Practice</a>
            <a href="#library" class={sectionLinkClass}>Library</a>
            <a href="#progress" class={sectionLinkClass}>Progress</a>
            <a href="#goals" class={sectionLinkClass}>Goals</a>
            <a href="#tools" class={sectionLinkClass}>Tools</a>
        </nav>
    </div>

    <Page.Section
        id="start"
        title="Quick start"
        description="Solve a problem, see what needs attention, come back when it is due."
    >
        <div class="flex flex-col gap-4 border-t border-border/60 py-4">
            <p class="type-secondary text-muted-foreground">
                Practice hands you a problem. After you submit, Progress remembers
                what still needs work. Review is the list of problems ready to
                revisit — it lives under Progress, not as a separate destination.
            </p>
            <div class="flex flex-col gap-2 sm:flex-row">
                <Button onclick={openReplay}>
                    Replay introduction
                </Button>
                <Button href={resolve("/practice?session=root")} variant="outline">
                    Start practicing
                    <Icon name="arrow_forward" />
                </Button>
            </div>
        </div>
    </Page.Section>

    <Page.Section
        id="practice"
        title="Practice"
        description="Receive the next useful problem, grouped into a session if you want a name for the sitting."
    >
        <div class="flex flex-col gap-4 border-t border-border/60 py-4">
            <p class="type-secondary text-muted-foreground">
                Opening Practice without a session shows your sittings. Ungrouped
                practice is always available; a named session keeps one stretch of
                work together so you can return to it.
            </p>
            <Button href={resolve("/practice")} variant="outline" class="self-start">
                Open Practice
                <Icon name="arrow_forward" />
            </Button>
        </div>
    </Page.Section>

    <Page.Section
        id="library"
        title="Library"
        description="Choose a competition, a test, or a single problem instead of taking whatever Practice draws."
    >
        <div class="flex flex-col gap-4 border-t border-border/60 py-4">
            <p class="type-secondary text-muted-foreground">
                Search by problem, browse tests, or open a series and work through
                its papers. Use this when you already know which contest you want.
            </p>
            <Button href={resolve("/library")} variant="outline" class="self-start">
                Browse Library
                <Icon name="arrow_forward" />
            </Button>
        </div>
    </Page.Section>

    <Page.Section
        id="progress"
        title="Progress"
        description="Overview, Review, the Series matrix, and History live together."
    >
        <div class="flex flex-col gap-4 border-t border-border/60 py-4">
            <p class="type-secondary text-muted-foreground">
                Overview is recent results. Review is problems due to come back.
                The Series matrix is every problem in a competition, shaded by
                how it went. History is the chronological log.
            </p>
            <div class="flex flex-col gap-2 sm:flex-row">
                <Button href={resolve("/progress")} variant="outline">
                    Open Progress
                    <Icon name="arrow_forward" />
                </Button>
                <Button href={resolve("/progress?view=review")} variant="outline">
                    Open Review
                </Button>
            </div>
        </div>
    </Page.Section>

    <Page.Section
        id="goals"
        title="Goals"
        description="An optional finish line on a slice of the catalog."
    >
        <div class="flex flex-col gap-4 border-t border-border/60 py-4">
            <p class="type-secondary text-muted-foreground">
                You do not need a goal to start. Once you set one, Home keeps it
                in view and the primary action practices toward it. Creation,
                editing, and the full list stay on Goals.
            </p>
            <Button href={resolve("/goals")} variant="outline" class="self-start">
                Open Goals
                <Icon name="arrow_forward" />
            </Button>
        </div>
    </Page.Section>

    <Page.Section
        id="tools"
        title="Coach, Whiteboard, and offline"
        description="Optional tools around the same problems."
    >
        <div class="flex flex-col gap-6 border-t border-border/60 py-4">
            {#if aiCoachEnabled}
                <div class="flex flex-col gap-2">
                    <p class="type-body font-medium text-foreground">Coach</p>
                    <p class="type-secondary text-muted-foreground">
                        Hints on the problem in front of you. Your own API key
                        stays in the browser. Open it from the Coach tab, or from
                        the button on a problem.
                    </p>
                    <Button href={resolve("/coach")} variant="outline" class="self-start">
                        Open Coach
                        <Icon name="arrow_forward" />
                    </Button>
                </div>
            {/if}

            <div class="flex flex-col gap-2">
                <p class="type-body font-medium text-foreground">Whiteboard</p>
                <p class="type-secondary text-muted-foreground">
                    Scratch paper for diagrams and algebra, next to a problem or
                    on its own page.
                </p>
                <Button href={resolve("/whiteboard")} variant="outline" class="self-start">
                    Open Whiteboard
                    <Icon name="arrow_forward" />
                </Button>
            </div>

            <div class="flex flex-col gap-2">
                <p class="type-body font-medium text-foreground">Offline</p>
                <p class="type-secondary text-muted-foreground">
                    Download competitions to this device so practice still works
                    without a network.
                </p>
                <Button href={resolve("/offline")} variant="outline" class="self-start">
                    Downloaded content
                    <Icon name="arrow_forward" />
                </Button>
            </div>
        </div>
    </Page.Section>
</Page.Root>

<Modal
    bind:open={replayOpen}
    title="Introduction"
    size="xl"
    onClose={closeReplay}
>
    {#if replayOpen}
        <TourView
            layout="dialog"
            username={data.profile?.username ?? null}
            onskip={skipReplay}
            onadvance={advanceReplay}
            onfinish={finishReplay}
        />
    {/if}
</Modal>
