<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import { type VariantProps, tv } from "tailwind-variants";
    import type { ToastSeverity } from "$lib/state/toast.svelte";

    export const toastVariants = tv({
        base: "pointer-events-auto flex w-80 items-start gap-3 rounded-md border border-l-4 border-border bg-surface-container-high p-sm text-foreground shadow-lg",
        variants: {
            severity: {
                info: "border-l-primary [&_[data-slot=toast-icon]]:text-primary",
                success:
                    "border-l-tertiary [&_[data-slot=toast-icon]]:text-tertiary",
                warning:
                    "border-l-secondary [&_[data-slot=toast-icon]]:text-secondary",
                error: "border-l-error [&_[data-slot=toast-icon]]:text-error",
            },
        },
        defaultVariants: {
            severity: "info",
        },
    });

    const SEVERITY_ICON: Record<ToastSeverity, string> = {
        info: "info",
        success: "check_circle",
        warning: "warning",
        error: "error",
    };

    export type ToastProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        severity?: ToastSeverity;
        title?: string;
        message: string;
        onDismiss?: () => void;
    };
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";

    let {
        class: className,
        severity = "info",
        title,
        message,
        onDismiss,
        ref = $bindable(null),
        ...restProps
    }: ToastProps = $props();
</script>

<div
    bind:this={ref}
    data-slot="toast"
    role="status"
    aria-live="polite"
    class={cn(toastVariants({ severity }), className)}
    {...restProps}
>
    <Icon data-slot="toast-icon" name={SEVERITY_ICON[severity]} fill />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        {#if title}
            <span class="truncate text-sm font-semibold">{title}</span>
        {/if}
        <span
            class={cn(
                "text-sm",
                title ? "text-muted-foreground" : "font-medium",
            )}>{message}</span
        >
    </div>
    <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss notification"
        onclick={onDismiss}
    >
        <Icon name="close" />
    </Button>
</div>
