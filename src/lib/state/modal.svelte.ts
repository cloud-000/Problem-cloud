import type { Component } from "svelte";
import type { ButtonVariant } from "$lib/components/button";
import ConfirmModal from "$lib/components/modal/ConfirmModal.svelte";

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

export interface ConfirmModalOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: ButtonVariant;
    size?: ModalSize;
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

    /**
     * Ask the user to confirm an action using the in-app modal.
     * Prefer this over `window.confirm` — browsers suppress or auto-cancel
     * native dialogs on mobile (especially inside async handlers).
     */
    confirm(options: ConfirmModalOptions): Promise<boolean> {
        return new Promise((resolve) => {
            let accepted = false;
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            this.show(
                ConfirmModal,
                {
                    message: options.message,
                    confirmLabel: options.confirmLabel,
                    cancelLabel: options.cancelLabel,
                    confirmVariant: options.confirmVariant,
                    onDecide: (value: boolean) => {
                        accepted = value;
                        this.close();
                    },
                },
                {
                    title: options.title ?? "Confirm",
                    size: options.size ?? "sm",
                    onClose: () => finish(accepted),
                },
            );
        });
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
