import type { Component } from "svelte";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface ModalOptions {
    title?: string;
    description?: string;
    size?: ModalSize;
    closeOnOutsideClick?: boolean;
    closeOnEscape?: boolean;
    overflowVisible?: boolean;
    class?: string;
    onClose?: () => void;
}

export interface ActiveModal {
    id: string;
    component: Component<any, any>;
    props?: Record<string, any>;
    options?: ModalOptions;
}

class ModalStore {
    activeModal = $state<ActiveModal | null>(null);

    /** Show a modal with the given Svelte component, props, and options. */
    show<P extends Record<string, any>>(
        component: Component<P, any>,
        props?: P,
        options?: ModalOptions
    ): string {
        const id = Math.random().toString(36).substring(2, 9);
        this.activeModal = {
            id,
            component: component as any,
            props,
            options
        };
        return id;
    }

    /** Close the current active modal. */
    close() {
        if (this.activeModal) {
            const current = this.activeModal;
            this.activeModal = null;
            current.options?.onClose?.();
        }
    }
}

export const modal = new ModalStore();
