<script lang="ts">
    import { modal } from "$lib/state/modal.svelte";
    import Modal from "./modal.svelte";
</script>

{#if modal.activeModal}
    {@const active = modal.activeModal}
    {@const Component = active.component}
    <Modal
        open={true}
        title={active.options?.title}
        description={active.options?.description}
        size={active.options?.size}
        closeOnOutsideClick={active.options?.closeOnOutsideClick}
        closeOnEscape={active.options?.closeOnEscape}
        class={active.options?.class}
        onClose={() => modal.close()}
    >
        <Component {...(active.props || {})} />
    </Modal>
{/if}
