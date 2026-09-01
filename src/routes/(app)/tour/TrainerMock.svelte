<script lang="ts">
    import { onDestroy } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import {
        AIChatComposer,
        AIChatMessageList,
        AIChatQuickActions,
        type AIChatController,
        type AIChatQuickAction,
    } from "$lib/components/ai-chat";
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { MathStatement } from "$lib/components/math-statement";
    import { ProblemAnswer } from "$lib/components/problem";
    import { RangeSlider } from "$lib/components/range-slider";
    import { ResizablePanel } from "$lib/components/resizable-panel";
    import { Switch } from "$lib/components/toggle";
    import { WhiteboardPanel } from "$lib/components/whiteboard";
    import {
        HINT_LADDER,
        hintQuickAction,
        hintRungFromActionId,
        type HintRung,
    } from "$lib/ai/hints";
    import { PROBLEM_SUPPORT_ACTIONS } from "$lib/ai/quick-actions";
    import { TOPICS } from "$lib/library";
    import { WhiteboardStore } from "$lib/state/whiteboard.svelte";
    import { RATING_RANGE } from "$lib/trainer";
    import type {
        AIErrorPart,
        AIModelReference,
        NormalizedAIMessage,
        NormalizedAIModel,
    } from "$lib/ai/types";
    import { cn } from "$lib/utils";
    import { answersMatch } from "$lib/utils/answer-matcher";
    import HintRail from "../practice/HintRail.svelte";

    type Tool = "none" | "whiteboard" | "settings";

    const STATEMENT = "What is $2^3 + 1$?";
    const ANSWER_KEY = "9";
    const SERIES_OPTIONS = [
        { value: "amc10", label: "AMC 10" },
        { value: "amc12", label: "AMC 12" },
        { value: "aime", label: "AIME" },
    ];
    const TOUR_COACH_CAPABILITIES = {
        chat: true,
        streaming: true,
        tools: false,
        vision: false,
        structuredOutput: false,
    };
    const TOUR_COACH_MODELS: NormalizedAIModel[] = [
        {
            reference: "sample:coach",
            providerId: "sample",
            id: "coach",
            label: "Coach",
            description: "Sample replies for the introduction.",
            capabilities: TOUR_COACH_CAPABILITIES,
            tags: [],
            available: true,
        },
    ];
    const HINT_REPLIES: Record<string, string> = {
        nudge: "Notice the exponent: $2^3$ is a small power you can evaluate by hand.",
        strategy:
            "Evaluate the power first, then add. Order of operations is the whole idea.",
        "first-step":
            "$2^3 = 2 \\times 2 \\times 2 = 8$. Now what happens when you add one?",
        walkthrough:
            "$2^3$ is eight, then add one. That is the value the problem is asking for.",
    };

    class TourCoachController implements AIChatController {
        #timer: ReturnType<typeof setInterval> | null = null;
        #lastPrompt = "";
        #sequence = 0;
        messages = $state<NormalizedAIMessage[]>([]);
        draft = $state("");
        selectedModel = $state<AIModelReference>("sample:coach");
        models = TOUR_COACH_MODELS;
        streaming = $state(false);
        error = $state<AIErrorPart | null>(null);
        liveAnnouncement = $state("");

        send(prompt = this.draft): void {
            const value = prompt.trim();
            if (!value || this.streaming) return;
            this.#lastPrompt = value;
            this.draft = "";
            this.error = null;
            this.streaming = true;
            this.liveAnnouncement = "Coach is answering";
            const assistantId = this.id("assistant");
            this.messages = [
                ...this.messages,
                this.message("user", value),
                {
                    id: assistantId,
                    role: "assistant",
                    parts: [{ type: "text", text: "" }],
                    status: "streaming",
                    createdAt: new Date().toISOString(),
                    resolvedModel: "sample:coach",
                },
            ];

            const reply = replyFor(value);
            let index = 0;
            this.#timer = setInterval(() => {
                const message = this.messages.find(
                    (candidate) => candidate.id === assistantId,
                );
                const text = message?.parts[0];
                if (!message || text?.type !== "text") return;
                index += 1;
                text.text = reply.slice(0, Math.ceil((reply.length * index) / 3));
                if (index >= 3) {
                    text.text = reply;
                    message.status = "complete";
                    this.finish("Coach reply complete");
                }
            }, 220);
        }

        stop(): void {
            const current = this.messages.findLast(
                (message) => message.status === "streaming",
            );
            if (current) current.status = "cancelled";
            this.finish("Coach reply stopped");
        }

        retry(): void {
            this.error = null;
            if (this.#lastPrompt) this.send(this.#lastPrompt);
        }

        private message(
            role: "user" | "assistant",
            text: string,
        ): NormalizedAIMessage {
            return {
                id: this.id(role),
                role,
                parts: [{ type: "text", text }],
                status: "complete",
                createdAt: new Date().toISOString(),
            };
        }

        private id(prefix: string): string {
            this.#sequence += 1;
            return `${prefix}-${this.#sequence}`;
        }

        private finish(announcement: string): void {
            if (this.#timer) clearInterval(this.#timer);
            this.#timer = null;
            this.streaming = false;
            this.liveAnnouncement = announcement;
        }
    }

    function replyFor(prompt: string): string {
        const rung = HINT_LADDER.find((entry) => entry.prompt === prompt);
        if (rung) return HINT_REPLIES[rung.id] ?? HINT_REPLIES.nudge;
        const q = prompt.toLowerCase();
        if (q.includes("hint") || q.includes("stuck") || q.includes("nudge")) {
            return HINT_REPLIES.nudge;
        }
        if (q.includes("approach") || q.includes("right") || q.includes("correct")) {
            return "That is the right idea — $2^3 = 8$, then add one.";
        }
        if (q.includes("explain") || q.includes("asking")) {
            return "It is asking for the value of a power plus one. Compute the power first.";
        }
        if (q.includes("answer") || q.includes("what is")) {
            return "Try the problem first. If you want a nudge, ask for a hint rather than the answer.";
        }
        return "Ask for a small hint, or talk through the idea. I will not spoil the answer on the first try.";
    }

    let tool = $state<Tool>("none");
    let coachMode = $state(false);
    let answer = $state("");
    let submitted = $state(false);
    let correct = $state<boolean | null>(null);
    let hintLevel = $state(0);
    let topics = $state<string[]>(["A"]);
    let series = $state<string[]>(["amc10"]);
    let rating = $state<[number, number]>([1200, 1800]);
    let timerOn = $state(true);
    let focusMode = $state(false);
    const whiteboardStore = new WhiteboardStore();
    const coach = new TourCoachController();
    const sideBySideQuery = new MediaQuery("(min-width: 768px)", false);

    let coachExpanded = $derived(coachMode && coach.messages.length > 0);
    let composerHeight = $state(0);
    let nextHintAction = $derived(hintQuickAction(hintLevel));
    let coachQuickActions = $derived<AIChatQuickAction[]>([
        ...(nextHintAction ? [nextHintAction] : []),
        ...PROBLEM_SUPPORT_ACTIONS,
    ]);
    let sideBySide = $derived(sideBySideQuery.current);
    let stageWidth = $state(0);
    let stageHeight = $state(0);
    let railMaxWidth = $derived(
        Math.max(240, Math.round(Math.min(480, stageWidth * 0.6 || 420))),
    );
    let railMaxHeight = $derived(
        Math.max(180, Math.round(Math.min(400, stageHeight * 0.75 || 240))),
    );

    onDestroy(() => coach.stop());

    function toggle(next: Tool) {
        tool = tool === next ? "none" : next;
    }

    function toggleCoach() {
        coachMode = !coachMode;
    }

    function takeHint(rung: HintRung) {
        coachMode = true;
        hintLevel += 1;
        coach.send(rung.prompt);
    }

    function selectCoachQuickAction(action: AIChatQuickAction) {
        const rung = hintRungFromActionId(action.id);
        if (rung) takeHint(rung);
        else coach.send(action.prompt);
    }

    function submit() {
        if (answer.trim() === "" || submitted) return;
        submitted = true;
        coachMode = false;
        correct = answersMatch(answer, ANSWER_KEY);
    }

    function loadNext() {
        submitted = false;
        correct = null;
        answer = "";
        coachMode = false;
    }
</script>

<div
    class={cn(
        "flex min-h-0 flex-1 flex-col bg-surface-container-lowest",
        tool === "settings" ? "overflow-visible" : "overflow-hidden",
    )}
>
    <div
        class="flex items-center gap-1 border-b border-border px-2 py-1.5"
        role="toolbar"
        aria-label="Practice tools"
    >
        <span
            class="mr-1 inline-flex size-8 items-center justify-center text-muted-foreground"
            aria-hidden="true"
        >
            <Icon name="arrow_back" />
        </span>
        <span class="min-w-0 flex-1 truncate type-caption text-foreground">
            Mixed practice
        </span>
        <span class="px-2 font-mono type-caption tabular-nums text-foreground">
            0:42
        </span>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                coachMode && "bg-muted text-foreground",
            )}
            aria-pressed={coachMode}
            aria-label={coachMode ? "Return to answer mode" : "Switch to Coach mode"}
            title={coachMode ? "Return to answer mode" : "Coach mode"}
            onclick={toggleCoach}
        >
            <Icon name="auto_awesome" fill={coachMode} />
        </Button>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                tool === "whiteboard" && "bg-muted text-foreground",
            )}
            aria-pressed={tool === "whiteboard"}
            aria-label="Whiteboard"
            title="Whiteboard"
            onclick={() => toggle("whiteboard")}
        >
            <Icon name="draw" fill={tool === "whiteboard"} />
        </Button>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                tool === "settings" && "bg-muted text-foreground",
            )}
            aria-pressed={tool === "settings"}
            aria-label="More Practice options"
            title="More options · Settings"
            onclick={() => toggle("settings")}
        >
            <Icon name="more_horiz" />
        </Button>
    </div>

    <div
        bind:clientWidth={stageWidth}
        bind:clientHeight={stageHeight}
        class={cn(
            "flex min-h-0 flex-1 flex-col md:flex-row",
            tool === "settings" ? "overflow-visible" : "overflow-hidden",
        )}
    >
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
                class={cn(
                    "flex min-h-0 flex-col items-center gap-5 overflow-y-auto px-4 py-4",
                    coachExpanded
                        ? "max-h-[42%] shrink-0 border-b border-border/60 pb-4"
                        : "flex-1 pb-3",
                )}
            >
                <div
                    class="my-auto flex min-h-fit w-full flex-none items-start justify-center"
                >
                    <MathStatement
                        text={STATEMENT}
                        class="type-problem w-full max-w-[48rem] text-left font-serif text-foreground"
                    />
                </div>
                {#if !coachMode}
                    <div class="flex w-full max-w-[48rem] flex-col gap-1.5">
                        {#if !submitted}
                            <HintRail
                                level={hintLevel}
                                onselect={(rung) => takeHint(rung)}
                            />
                        {/if}
                        <ProblemAnswer
                            choices={[ANSWER_KEY]}
                            answerIndex={0}
                            answerStatus="known"
                            bind:answer
                            showAnswerState={submitted}
                            disabled={submitted}
                            onEnter={submitted ? loadNext : submit}
                        />
                    </div>
                {/if}
            </div>

            {#if coachMode}
                <div
                    class={cn(
                        "relative flex w-full flex-col",
                        coachExpanded ? "min-h-0 flex-1" : "h-auto shrink-0 justify-end",
                    )}
                    style="--ai-chat-composer-h: {coachExpanded ? composerHeight : 0}px;"
                    aria-label="Sample Coach"
                >
                    {#if coachExpanded}
                        <AIChatMessageList
                            controller={coach}
                            assistantLabel="Coach"
                            conversationLabel="Sample Coach conversation"
                            class="[scrollbar-gutter:stable_both-edges]"
                            contentClass="mx-auto w-full max-w-[52rem]"
                        />
                    {/if}
                    <div
                        bind:clientHeight={composerHeight}
                        class={cn(
                            "z-10 mx-auto w-full max-w-[52rem]",
                            coachExpanded
                                ? "pointer-events-none absolute inset-x-0 bottom-0"
                                : "shrink-0",
                        )}
                    >
                        <AIChatQuickActions
                            actions={coachQuickActions}
                            layout="row"
                            disabled={coach.streaming}
                            class={cn(
                                "pointer-events-auto px-3 sm:px-4",
                                coachExpanded
                                    ? "pb-1 pt-2"
                                    : "flex-nowrap overflow-x-auto pb-0 pt-1",
                            )}
                            onselect={selectCoachQuickAction}
                        />
                        <AIChatComposer
                            controller={coach}
                            assistantLabel="Coach"
                            placeholder="Ask Coach about this problem…"
                            compact={!coachExpanded}
                        />
                    </div>
                    <div class="sr-only" aria-live="polite">
                        {coach.liveAnnouncement}
                    </div>
                </div>
            {/if}
        </div>

        {#snippet toolRail(kind: "whiteboard" | "settings")}
            {#key `${kind}-${sideBySide ? "side" : "stack"}`}
                <ResizablePanel
                    edges={sideBySide ? ["left"] : ["top"]}
                    initialWidth={sideBySide
                        ? kind === "whiteboard"
                            ? 360
                            : 280
                        : undefined}
                    initialHeight={sideBySide
                        ? undefined
                        : kind === "whiteboard"
                          ? 280
                          : 220}
                    minWidth={kind === "whiteboard" ? 240 : 200}
                    maxWidth={railMaxWidth}
                    minHeight={kind === "whiteboard" ? 200 : 160}
                    maxHeight={railMaxHeight}
                    collapseWidthBelowMin={sideBySide}
                    collapseHeightBelowMin={!sideBySide}
                    revealAxis={sideBySide ? "horizontal" : "vertical"}
                    onCollapse={() => (tool = "none")}
                    class={cn(
                        "flex min-h-52 w-full min-w-0 shrink-0 flex-col md:min-h-0 md:border-t-0 md:border-l",
                        kind === "whiteboard"
                            ? "overflow-hidden border-t border-border bg-background"
                            : "overflow-visible border-t border-border bg-surface-container-low",
                    )}
                >
                    {#if kind === "whiteboard"}
                        <aside
                            class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                            aria-label="Sample whiteboard"
                        >
                            <WhiteboardPanel store={whiteboardStore} />
                        </aside>
                    {:else}
                        <aside
                            class="flex h-full min-h-0 min-w-0 flex-col overflow-visible p-3"
                            aria-label="Sample settings"
                        >
                            <p
                                class="flex items-center gap-1.5 type-caption font-medium text-foreground"
                            >
                                <Icon name="tune" class="size-3.5" />
                                Settings
                            </p>
                            <div class="mt-3 flex min-h-0 flex-col gap-3">
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                        >Topic</span
                                    >
                                    <Combobox
                                        bind:value={topics}
                                        options={TOPICS}
                                        strict
                                        placeholder="Any topic"
                                        inputPlaceholder="Add topic"
                                        class="bg-surface-container-lowest"
                                    />
                                </div>
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                        >Series</span
                                    >
                                    <Combobox
                                        bind:value={series}
                                        options={SERIES_OPTIONS}
                                        strict
                                        placeholder="All series"
                                        inputPlaceholder="Add series"
                                        class="bg-surface-container-lowest"
                                    />
                                </div>
                                <div class="flex flex-col gap-1.5">
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                    >
                                        Difficulty — problem rating ({rating[0]}–{rating[1]})
                                    </span>
                                    <RangeSlider
                                        bind:value={rating}
                                        min={RATING_RANGE[0]}
                                        max={RATING_RANGE[1]}
                                        step={50}
                                        label="Difficulty (problem rating)"
                                    />
                                </div>
                                <div
                                    class="flex items-center justify-between gap-3 border-t border-border/40 pt-2"
                                >
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                        >Timer</span
                                    >
                                    <Switch bind:checked={timerOn} size="sm" />
                                </div>
                                <div
                                    class="flex items-center justify-between gap-3"
                                >
                                    <span
                                        class="text-xs font-medium text-muted-foreground"
                                        >Focus mode</span
                                    >
                                    <Switch
                                        bind:checked={focusMode}
                                        size="sm"
                                    />
                                </div>
                            </div>
                        </aside>
                    {/if}
                </ResizablePanel>
            {/key}
        {/snippet}

        {#if tool === "whiteboard"}
            {@render toolRail("whiteboard")}
        {:else if tool === "settings"}
            {@render toolRail("settings")}
        {/if}
    </div>

    <footer
        class="grid min-h-14 w-full shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-t border-border/60 bg-background px-3 py-2"
    >
        <div class="flex min-w-0 items-center gap-1 justify-self-start">
            <Button
                variant="ghost"
                disabled
                aria-label="Previous problem"
                class="h-auto px-2 py-1.5 text-xs font-normal text-muted-foreground hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5"
            >
                <Icon name="arrow_back" />
            </Button>
            {#if !submitted}
                <Button
                    variant="ghost"
                    disabled
                    aria-label="Skip Problem"
                    class="h-auto px-2 py-1.5 text-xs font-normal text-muted-foreground hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5"
                >
                    <Icon name="skip_next" />
                </Button>
            {/if}
        </div>

        {#if !submitted}
            <Button
                variant="outline"
                aria-pressed={coachMode}
                aria-label={coachMode
                    ? "Switch to answer mode"
                    : "Switch to Coach mode"}
                title={coachMode ? "Return to answer mode" : "Switch to Coach mode"}
                onclick={toggleCoach}
                class="h-9 justify-self-center gap-0.5 rounded-lg p-1 text-[11px] font-semibold"
            >
                <span
                    class={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        !coachMode && "bg-primary text-primary-foreground shadow-sm",
                    )}
                >
                    Answer
                </span>
                <span
                    class={cn(
                        "rounded-md px-2 py-1 transition-colors",
                        coachMode && "bg-muted text-foreground",
                    )}
                >
                    Coach
                </span>
            </Button>
        {/if}

        <div class="col-start-3 flex min-w-0 items-center gap-2 justify-self-end">
            {#if submitted}
                <span
                    class={cn(
                        "type-caption text-muted-foreground",
                        correct === true && "text-correct",
                        correct === false && "text-destructive",
                    )}
                >
                    {correct === true ? "Correct" : "Incorrect"}
                </span>
                <Button
                    variant="primary"
                    onclick={loadNext}
                    class="h-9 gap-1.5 rounded-lg px-4 text-xs font-semibold"
                >
                    Next
                    <Icon name="arrow_forward" />
                </Button>
            {:else}
                <Button
                    variant="primary"
                    disabled={answer.trim() === ""}
                    onclick={submit}
                    class="h-9 rounded-lg px-4 text-xs font-semibold"
                >
                    Submit
                </Button>
            {/if}
        </div>
    </footer>
</div>
