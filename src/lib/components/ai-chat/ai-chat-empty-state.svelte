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
    class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 pt-8"
    style="padding-bottom: calc(var(--ai-chat-composer-h, 0px) + 2rem);"
>
    <div class="flex w-full max-w-2xl flex-col items-center text-center">
        <div
            class="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
            <Icon name={icon} fontsize={20} fill />
        </div>
        <h3 class="mt-3.5 text-base font-semibold tracking-tight text-foreground">{title}</h3>
        <p class="mt-1.5 max-w-4xl text-xs leading-5 text-muted-foreground">
            {description}
        </p>
        <AIChatQuickActions
            actions={quickActions}
            layout="stack"
            class="mt-5 w-full"
            onselect={(action) => controller.send(action.prompt)}
        />
    </div>
</div>
