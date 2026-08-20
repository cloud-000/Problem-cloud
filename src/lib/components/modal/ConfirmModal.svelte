<script lang="ts">
    import { Button, type ButtonVariant } from "$lib/components/button";

    let {
        message,
        confirmLabel = "Confirm",
        cancelLabel = "Cancel",
        confirmVariant = "primary",
        onDecide,
    }: {
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        confirmVariant?: ButtonVariant;
        onDecide: (accepted: boolean) => void;
    } = $props();
</script>

<div class="space-y-4">
    <p class="text-sm text-foreground whitespace-pre-wrap">{message}</p>
    <div class="flex justify-end gap-2">
        <Button variant="outline" onclick={() => onDecide(false)}>
            {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onclick={() => onDecide(true)}>
            {confirmLabel}
        </Button>
    </div>
</div>
