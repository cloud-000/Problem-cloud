<script lang="ts">
    import { Modal } from "$lib/components/modal";
    import { modal, type ModalSize } from "$lib/state/modal.svelte";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Switch } from "$lib/components/toggle";
    import { Select } from "$lib/components/select";

    // Test content components
    import InfoModalContent from "./InfoModalContent.svelte";
    import ScrollModalContent from "./ScrollModalContent.svelte";
    import FormModalContent from "./FormModalContent.svelte";

    // Inline modal state
    let inlineOpen = $state(false);

    // Global modal configurations
    let modalSize = $state<string>("md");
    let closeOnOutsideClick = $state(true);
    let closeOnEscape = $state(true);

    const sizeOptions = [
        { value: "sm", label: "Small (sm)" },
        { value: "md", label: "Medium (md)" },
        { value: "lg", label: "Large (lg)" },
        { value: "xl", label: "Extra Large (xl)" },
        { value: "full", label: "Full Screen (full)" }
    ];

    function openInfoModal() {
        modal.show(InfoModalContent, {}, {
            title: "Global Info Modal",
            description: "Shows basic information using modal.show() store",
            size: modalSize as ModalSize,
            closeOnOutsideClick,
            closeOnEscape
        });
    }

    function openScrollModal() {
        modal.show(ScrollModalContent, {}, {
            title: "Global Scrollable Modal",
            description: "Validates backdrop lock and inner scrolling",
            size: modalSize as ModalSize,
            closeOnOutsideClick,
            closeOnEscape
        });
    }

    function openFormModal() {
        modal.show(FormModalContent, {}, {
            title: "Global Form Modal",
            description: "Interactive form field bindings",
            size: modalSize as ModalSize,
            closeOnOutsideClick,
            closeOnEscape
        });
    }
</script>

<div class="space-y-8 pb-12">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="picture_in_picture" fontsize="2.25rem" class="text-primary-foreground" />
            Modal Test Bench
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Interactive playground to verify Svelte 5 popup modals, size variations, and global store behavior.
        </p>
    </div>

    <!-- Live Status Console -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs">
        <h2 class="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <Icon name="terminal" class="text-muted-foreground" />
            Live State Monitor
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono bg-muted/30 p-4 rounded-lg border border-border/40">
            <div>
                <span class="text-muted-foreground">Inline Modal Open:</span>
                <span class={inlineOpen ? "text-primary-foreground font-semibold" : "text-foreground"}>
                    {inlineOpen}
                </span>
            </div>
            <div>
                <span class="text-muted-foreground">Global Modal ID:</span>
                <span class={modal.activeModal ? "text-primary-foreground font-semibold" : "text-foreground"}>
                    {modal.activeModal ? modal.activeModal.id : "null (closed)"}
                </span>
            </div>
            <div>
                <span class="text-muted-foreground">Global Active Size:</span>
                <span class="text-foreground">
                    {modal.activeModal?.options?.size || "N/A"}
                </span>
            </div>
            <div>
                <span class="text-muted-foreground">Body overflow-y:</span>
                <span class="text-foreground">
                    {modal.activeModal || inlineOpen ? "hidden (scroll locked)" : "scroll"}
                </span>
            </div>
        </div>
    </div>

    <!-- Playground Configuration -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs space-y-4">
        <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="settings" class="text-muted-foreground" />
            Global Modal Options
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div class="flex flex-col gap-1.5">
                <span class="text-xs font-medium text-muted-foreground">Modal Width Size</span>
                <Select bind:value={modalSize} options={sizeOptions} />
            </div>

            <div class="flex items-center justify-between border border-border/60 rounded-lg p-3 bg-muted/10">
                <div class="flex flex-col gap-0.5">
                    <span class="text-xs font-medium text-foreground">Escape Key Close</span>
                    <span class="text-[11px] text-muted-foreground">Closes dialog on Escape</span>
                </div>
                <Switch bind:checked={closeOnEscape} />
            </div>

            <div class="flex items-center justify-between border border-border/60 rounded-lg p-3 bg-muted/10">
                <div class="flex flex-col gap-0.5">
                    <span class="text-xs font-medium text-foreground">Backdrop Click Close</span>
                    <span class="text-[11px] text-muted-foreground">Closes on clicking backdrop</span>
                </div>
                <Switch bind:checked={closeOnOutsideClick} />
            </div>
        </div>
    </div>

    <!-- Action Triggers -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Inline Modal Tester -->
        <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs flex flex-col justify-between">
            <div>
                <h3 class="text-lg font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="code" class="text-primary-foreground" />
                    Inline Modal
                </h3>
                <p class="text-sm text-muted-foreground mt-2">
                    Open a modal defined directly in Svelte markup using the <code>&lt;Modal&gt;</code> element. Controlled by local component state.
                </p>
            </div>
            <div class="mt-6 flex justify-start">
                <Button onclick={() => inlineOpen = true}>
                    <Icon name="launch" class="mr-1" />
                    Open Inline Modal
                </Button>
            </div>
        </div>

        <!-- Global Modal Store Tester -->
        <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs flex flex-col justify-between">
            <div>
                <h3 class="text-lg font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="cloud" class="text-primary-foreground" />
                    Global Modal Store
                </h3>
                <p class="text-sm text-muted-foreground mt-2">
                    Open modals dynamically from JS/TS code from anywhere in the application using the global <code>modal.show()</code> store.
                </p>
            </div>
            <div class="mt-6 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onclick={openInfoModal}>
                    Info Modal
                </Button>
                <Button variant="outline" size="sm" onclick={openScrollModal}>
                    Scroll Test
                </Button>
                <Button variant="outline" size="sm" onclick={openFormModal}>
                    Form Test
                </Button>
            </div>
        </div>
    </div>
</div>

<!-- Inline Modal Implementation -->
<Modal
    bind:open={inlineOpen}
    title="Inline Confirmation Dialog"
    description="This modal is declared inline in the Svelte page markup."
    size={modalSize as ModalSize}
    closeOnEscape={closeOnEscape}
    closeOnOutsideClick={closeOnOutsideClick}
>
    <div class="space-y-4">
        <p class="text-sm text-foreground">
            This component was declared directly as <code>&lt;Modal bind:open={"{inlineOpen}"}&gt;</code> in the <code>+page.svelte</code> file. It binds to the parent component's local reactive variables.
        </p>
        <div class="p-3 bg-primary-container/10 border border-primary-container/30 rounded-lg text-xs text-on-primary-container">
            <strong>Key Benefit:</strong> Excellent when the modal needs to close inline or interact intimately with parent template markup.
        </div>
    </div>
    {#snippet footer()}
        <Button variant="outline" onclick={() => inlineOpen = false}>Cancel</Button>
        <Button onclick={() => inlineOpen = false}>Proceed</Button>
    {/snippet}
</Modal>
