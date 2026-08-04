<script lang="ts" module>
    import type { AIChatController, AIChatQuickAction } from "./types";

    export interface AIChatEmptyStateProps {
        controller: AIChatController;
        title?: string;
        description?: string;
        icon?: string;
        quickActions?: readonly AIChatQuickAction[];
    }
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import AIChatQuickActions from "./ai-chat-quick-actions.svelte";

    let {
        controller,
        title = "How can I help?",
        description = "Start a conversation or choose one of the suggestions below.",
        icon = "auto_awesome",
        quickActions = [],
    }: AIChatEmptyStateProps = $props();
</script>

<div
    class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8"
>
    <div class="flex w-full max-w-2xl flex-col items-center text-center">
        <div
            class="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary-foreground"
        >
            <Icon name={icon} fontsize={22} />
        </div>
        <h3 class="mt-4 text-xl font-semibold tracking-tight">{title}</h3>
        <p class="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
        </p>
        <AIChatQuickActions
            actions={quickActions}
            layout="stack"
            class="mt-6 w-full"
            onselect={(action) => controller.send(action.prompt)}
        />
    </div>
</div>
