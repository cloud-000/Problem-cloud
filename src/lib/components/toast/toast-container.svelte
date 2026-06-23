<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import type { Toast as ToastData } from "$lib/state/toast.svelte";

    export type ToastContainerProps = WithElementRef<
        HTMLAttributes<HTMLDivElement>
    > & {
        /** Called when a toast's close button is pressed (e.g. to mark it read). */
        onDismiss?: (toast: ToastData) => void;
    };
</script>

<script lang="ts">
    import Toast from "./toast.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { fly } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { cubicOut } from "svelte/easing";

    let {
        class: className,
        onDismiss,
        ref = $bindable(null),
        ...restProps
    }: ToastContainerProps = $props();

    function dismiss(toast: ToastData) {
        onDismiss?.(toast);
        toasts.dismiss(toast.id);
    }
</script>

<div
    bind:this={ref}
    data-slot="toast-container"
    class={cn(
        "pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2",
        className,
    )}
    {...restProps}
>
    {#each toasts.toasts as toast (toast.id)}
        <div
            in:fly={{ x: 24, duration: 250, easing: cubicOut }}
            out:fly={{ x: 24, duration: 200, easing: cubicOut }}
            animate:flip={{ duration: 200, easing: cubicOut }}
        >
            <Toast
                severity={toast.severity}
                title={toast.title}
                message={toast.message}
                onDismiss={() => dismiss(toast)}
            />
        </div>
    {/each}
</div>
