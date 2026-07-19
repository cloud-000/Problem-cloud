<script lang="ts" module>
    import { type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";
    import type { Snippet } from "svelte";

    export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

    /**
     * `panel` (default): the standard centered dialog with chrome (surface panel,
     * header + close button, optional footer). `bare`: backdrop + `children` only —
     * no chrome — for full-bleed content like image lightboxes. In `bare` mode the
     * `class` prop styles the backdrop (there is no panel to receive it).
     */
    export type ModalVariant = "panel" | "bare";

    export type ModalProps = WithElementRef<HTMLAttributes<HTMLDivElement>> & {
        open: boolean;
        title?: string;
        description?: string;
        size?: ModalSize;
        variant?: ModalVariant;
        closeOnOutsideClick?: boolean;
        closeOnEscape?: boolean;
        overflowVisible?: boolean;
        onClose?: () => void;
        children?: Snippet;
        footer?: Snippet;
    };
</script>

<script lang="ts">
    import { cn } from "$lib/utils.js";
    import type { Attachment } from "svelte/attachments";
    import { fade, scale } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import { Icon } from "$lib/components/icon";
    import { Button } from "$lib/components/button";

    let {
        ref = $bindable(null),
        class: className,
        open = $bindable(),
        title,
        description,
        size = "md",
        variant = "panel",
        closeOnOutsideClick = true,
        closeOnEscape = true,
        overflowVisible = false,
        onClose,
        children,
        footer,
        ...restProps
    }: ModalProps = $props();

    function close() {
        open = false;
        onClose?.();
    }

    function handleOutsideClick(event: MouseEvent) {
        if (closeOnOutsideClick && event.target === event.currentTarget) {
            close();
        }
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (closeOnEscape && event.key === "Escape" && open) {
            close();
        }
    }

    // Render overlays at the document root so transformed, clipped, or
    // hover-composited ancestors can never trap them below app chrome.
    const portal: Attachment<HTMLDivElement> = (node) => {
        document.body.appendChild(node);
        return () => node.remove();
    };

    // Lock background scroll when open
    $effect(() => {
        if (open) {
            const originalStyle = window.getComputedStyle(document.body).overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = originalStyle;
            };
        }
    });

    const sizeClasses: Record<ModalSize, string> = {
        sm: "max-w-[24rem] w-full mx-4",
        md: "max-w-[32rem] w-full mx-4",
        lg: "max-w-[48rem] w-full mx-4",
        xl: "max-w-[64rem] w-full mx-4",
        full: "w-full h-full max-w-none rounded-none"
    };
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
    <div
        {@attach portal}
        bind:this={ref}
        class={cn(
            "fixed inset-0 z-80 flex items-center justify-center",
            variant === "bare"
                ? "bg-background/70 backdrop-blur-(--backdrop-blur) p-6"
                : "bg-black/40 backdrop-blur-xs p-md",
            // In bare mode there is no panel, so the consumer's `class` styles the backdrop.
            variant === "bare" && className,
        )}
        transition:fade={{ duration: 150, easing: cubicOut }}
        onclick={handleOutsideClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        aria-describedby={description ? "modal-desc" : undefined}
        {...restProps}
    >
        {#if variant === "bare"}
            {@render children?.()}
        {:else}
        <!-- Modal panel -->
        <div
            class={cn(
                "flex flex-col bg-surface-container-lowest border border-border/80 shadow-xl transition-all",
                overflowVisible ? "overflow-visible" : "overflow-hidden",
                size === "full" ? "h-full" : "rounded-xl max-h-[90vh]",
                sizeClasses[size],
                className
            )}
            transition:scale={{ duration: 150, start: 0.95, easing: cubicOut }}
        >
            <!-- Header -->
            <div class={cn(
                "flex items-center justify-between border-b border-border/60 px-md py-sm",
                size !== "full" && "rounded-t-xl"
            )}>
                <div class="flex flex-col gap-0.5">
                    {#if title}
                        <h2 id="modal-title" class="text-lg font-semibold text-foreground leading-tight">
                            {title}
                        </h2>
                    {/if}
                    {#if description}
                        <p id="modal-desc" class="text-xs text-muted-foreground">
                            {description}
                        </p>
                    {/if}
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:text-foreground rounded-full animate-none"
                    onclick={close}
                    aria-label="Close dialog"
                >
                    <Icon name="close" />
                </Button>
            </div>

            <!-- Body -->
            <div class={cn(
                "flex-1 px-md py-md text-sm text-foreground",
                overflowVisible ? "overflow-visible" : "overflow-y-auto"
            )}>
                {@render children?.()}
            </div>

            <!-- Footer -->
            {#if footer}
                <div class={cn(
                    "flex items-center justify-end gap-sm border-t border-border/60 px-md py-sm bg-surface-container-low/40",
                    size !== "full" && "rounded-b-xl"
                )}>
                    {@render footer()}
                </div>
            {/if}
        </div>
        {/if}
    </div>
{/if}
