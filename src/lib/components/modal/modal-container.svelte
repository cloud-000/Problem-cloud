<script lang="ts">
    import { modal } from "#lib/state/modal.svelte.js";
    import Modal from "./modal.svelte";
</script>

{#if modal.activeModal}
    {@const active = modal.activeModal}
    {@const Component = active?.component}
    <Modal
        open={true}
        title={active?.options?.title}
        description={active?.options?.description}
        size={active?.options?.size}
        closeOnOutsideClick={active?.options?.closeOnOutsideClick}
        closeOnEscape={active?.options?.closeOnEscape}
        overflowVisible={active?.options?.overflowVisible}
        class={active?.options?.class}
        onClose={() => modal.close()}
    >
        {#if Component}
            <Component {...(active?.props || {})} />
        {/if}
    </Modal>
{/if}
