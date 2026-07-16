<script lang="ts" module>
    import type { AIChatController } from "./types";

    export interface AIChatModelPickerProps {
        controller: AIChatController;
    }
</script>

<script lang="ts">
    import { Select } from "$lib/components/select";
    import { Icon } from "$lib/components/icon";

    let { controller }: AIChatModelPickerProps = $props();
    let options = $derived([
        { value: "auto", label: "Auto · Recommended" },
        ...controller.models.map((model) => ({
            value: model.reference,
            label: model.label,
            disabled: !model.available,
        })),
    ]);
</script>

<Select
    bind:value={controller.selectedModel}
    {options}
    aria-label="Conversation model"
    data-slot="ai-chat-model-picker"
    class="w-auto max-w-40"
>
    {#snippet triggerContent(option)}
        <span class="flex min-w-0 items-center gap-1.5">
            <Icon
                name="tune"
                fontsize={14}
                class="shrink-0 text-muted-foreground"
            />
            <span class="truncate text-[11px] font-medium">
                {option.value === "auto" ? "Auto" : option.label}
            </span>
        </span>
    {/snippet}
</Select>

<style>
    :global([data-slot="ai-chat-model-picker"]) {
        height: 1.75rem !important;
        width: auto !important;
        gap: 0.125rem;
        border: 0 !important;
        border-radius: var(--radius-lg) !important;
        background: transparent !important;
        padding: 0 0.375rem !important;
        box-shadow: none !important;
        font-size: 0.6875rem !important;
    }

    :global([data-slot="ai-chat-model-picker"]:hover),
    :global([data-slot="ai-chat-model-picker"][aria-expanded="true"]) {
        background: var(--color-surface-container-high) !important;
    }

    :global([data-slot="ai-chat-model-picker"]:focus-visible) {
        outline: 2px solid var(--color-ring);
        outline-offset: 1px;
    }

    :global([data-slot="ai-chat-model-picker"] > span:last-child) {
        padding-right: 0;
    }

    :global([data-slot="ai-chat-model-picker"] + ul[role="listbox"]) {
        top: auto;
        right: auto;
        bottom: 100%;
        left: 0;
        width: min(15rem, calc(100vw - 3rem));
        margin-top: 0;
        margin-bottom: 0.375rem;
    }
</style>
