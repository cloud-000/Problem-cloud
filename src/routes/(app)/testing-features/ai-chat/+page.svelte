<script lang="ts">
    import { onDestroy } from "svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import {
        AIChat,
        type AIChatController,
        type AIChatQuickAction,
    } from "$lib/components/ai-chat";
    import type {
        AIErrorPart,
        AIModelReference,
        NormalizedAIMessage,
        NormalizedAIModel,
    } from "$lib/ai/types";

    const capabilities = {
        chat: true,
        streaming: true,
        tools: true,
        vision: false,
        structuredOutput: false,
    };
    const DEMO_MODELS: NormalizedAIModel[] = [
        {
            reference: "demo:fast",
            providerId: "demo",
            id: "fast",
            label: "Demo Fast",
            description: "Local testing model",
            capabilities,
            tags: ["fast"],
            available: true,
        },
        {
            reference: "demo:offline",
            providerId: "demo",
            id: "offline",
            label: "Unavailable model",
            capabilities,
            tags: [],
            available: false,
            unavailableReason: "Included to test disabled options",
        },
    ];
    const quickActions: AIChatQuickAction[] = [
        {
            id: "explain",
            label: "Explain the component contract",
            prompt: "What does the AIChat controller own?",
        },
        {
            id: "stream",
            label: "Demonstrate a streaming response",
            prompt: "Show me how streaming looks.",
        },
    ];

    class DemoChatController implements AIChatController {
        messages = $state<NormalizedAIMessage[]>([]);
        draft = $state("");
        selectedModel = $state<AIModelReference>("auto");
        models = DEMO_MODELS;
        streaming = $state(false);
        error = $state<AIErrorPart | null>(null);
        liveAnnouncement = $state("");
        #timer: ReturnType<typeof setInterval> | null = null;
        #lastPrompt = "";
        #sequence = 0;

        send(prompt = this.draft): void {
            const value = prompt.trim();
            if (!value || this.streaming) return;
            this.#lastPrompt = value;
            this.draft = "";
            this.error = null;
            this.streaming = true;
            this.liveAnnouncement = "Demo response started";
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
                    resolvedModel:
                        this.selectedModel === "auto"
                            ? "demo:fast"
                            : this.selectedModel,
                },
            ];

            const chunks = [
                "This response is generated entirely by the testing page. ",
                "The reusable component owns presentation, while its controller ",
                "owns messages, transport behavior, models, errors, and cancellation.",
            ];
            let index = 0;
            this.#timer = setInterval(() => {
                const message = this.messages.find(
                    (candidate) => candidate.id === assistantId,
                );
                const text = message?.parts[0];
                if (!message || text?.type !== "text") return;
                text.text += chunks[index];
                index += 1;
                if (index === chunks.length) {
                    message.status = "complete";
                    this.finish("Demo response complete");
                }
            }, 350);
        }

        stop(): void {
            const current = this.messages.findLast(
                (message) => message.status === "streaming",
            );
            if (current) current.status = "cancelled";
            this.finish("Demo response stopped");
        }

        retry(): void {
            this.error = null;
            if (this.#lastPrompt) this.send(this.#lastPrompt);
        }

        reset(): void {
            this.finish("");
            this.messages = [];
            this.draft = "";
            this.error = null;
        }

        loadTranscript(): void {
            this.finish("");
            this.error = null;
            this.messages = [
                this.message("user", "Can this render math?"),
                {
                    ...this.message(
                        "assistant",
                        "Yes. Assistant text uses the shared math renderer, so $x^2 + y^2 = z^2$ works.",
                    ),
                    resolvedModel: "demo:fast",
                },
                {
                    id: this.id("tool"),
                    role: "assistant",
                    parts: [
                        { type: "status", label: "Checking a local demo tool" },
                        {
                            type: "tool",
                            runId: "demo-run",
                            tool: "demo.lookup",
                            status: "succeeded",
                            summary: "Loaded a simulated tool result",
                        },
                    ],
                    status: "complete",
                    createdAt: new Date().toISOString(),
                },
            ];
            this.liveAnnouncement = "Loaded sample transcript";
        }

        showError(): void {
            this.error = {
                type: "error",
                code: "demo_error",
                message: "Simulated retryable transport failure.",
                retryable: true,
            };
            this.#lastPrompt = "Retry the simulated request.";
            this.liveAnnouncement = "Demo error shown";
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

    const demo = new DemoChatController();
    onDestroy(() => demo.stop());
</script>

<div class="space-y-8">
    <div class="space-y-2 border-b border-border/80 pb-4">
        <h1
            class="flex items-center gap-2 text-3xl font-semibold tracking-tight text-foreground"
        >
            <Icon
                name="chat"
                fontsize="2rem"
                class="text-primary-foreground"
            />
            AI Chat
        </h1>
        <p class="text-sm text-muted-foreground">
            Provider-neutral chat rendering driven by a local mock controller.
            Nothing on this page calls the Coach store or AI endpoints.
        </p>
    </div>

    <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onclick={() => demo.reset()}>
            Empty state
        </Button>
        <Button
            size="sm"
            variant="outline"
            onclick={() => demo.loadTranscript()}
        >
            Sample transcript
        </Button>
        <Button size="sm" variant="outline" onclick={() => demo.showError()}>
            Retryable error
        </Button>
        <Button
            size="sm"
            variant="outline"
            onclick={() => demo.send("Stream a test response.")}
        >
            Start stream
        </Button>
    </div>

    <div
        class="h-[min(680px,75dvh)] min-h-[520px] overflow-hidden rounded-xl border border-border/80 bg-surface-container-lowest shadow-sm"
    >
        <AIChat
            controller={demo}
            assistantLabel="Demo Assistant"
            conversationLabel="AI chat component demonstration"
            placeholder="Message the demo assistant…"
            emptyTitle="Test the chat surface"
            emptyDescription="Use a suggestion, type a message, or load one of the states above."
            emptyIcon="chat_bubble"
            {quickActions}
        />
    </div>
</div>
