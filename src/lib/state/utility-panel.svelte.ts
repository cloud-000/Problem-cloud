import type { Snippet } from "svelte";

export type UtilityPanelView = "coach" | "practice-settings" | "whiteboard";

export interface UtilityPanelDimensionConfig {
    default: number;
    min: number;
    max: number;
}

export interface UtilityPanelMobileHeightConfig {
    defaultRatio: number;
    minRatio: number;
    maxRatio: number;
}

export interface UtilityPanelSizing {
    width?: UtilityPanelDimensionConfig;
    mobileHeight?: UtilityPanelMobileHeightConfig;
    storageKey?: string;
}

export interface UtilityPanelRegistration {
    view: UtilityPanelView;
    ownerId: string;
    content: Snippet;
    label: string;
    sizing?: UtilityPanelSizing;
}

class UtilityPanelStore {
    activeView = $state<UtilityPanelView | null>(null);
    registrations = $state<UtilityPanelRegistration[]>([]);
    invokingElement = $state<HTMLElement | null>(null);
    renderedWidth = $state(400);
    renderedHeight = $state(0);

    get activeRegistration(): UtilityPanelRegistration | null {
        if (!this.activeView) return null;
        return (
            this.registrations.findLast((registration) => registration.view === this.activeView) ?? null
        );
    }

    register(registration: UtilityPanelRegistration): () => void {
        this.registrations = [
            ...this.registrations.filter(
                (existing) =>
                    existing.ownerId !== registration.ownerId || existing.view !== registration.view,
            ),
            registration,
        ];
        return () => this.unregister(registration.view, registration.ownerId);
    }

    unregister(view: UtilityPanelView, ownerId: string): void {
        this.registrations = this.registrations.filter(
            (registration) => registration.view !== view || registration.ownerId !== ownerId,
        );
        if (this.activeView === view && !this.activeRegistration) this.close(false);
    }

    open(view: UtilityPanelView, invokingElement?: HTMLElement | null): boolean {
        const registration = this.registrations.find((candidate) => candidate.view === view);
        if (!registration) {
            this.activeView = null;
            return false;
        }
        this.invokingElement = invokingElement ??
            (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));
        this.activeView = view;
        return true;
    }

    close(restoreFocus = true): void {
        const target = this.invokingElement;
        this.activeView = null;
        this.invokingElement = null;
        if (restoreFocus && target) queueMicrotask(() => target.focus());
    }

    toggle(view: UtilityPanelView, invokingElement?: HTMLElement | null): void {
        if (this.activeView === view) this.close();
        else this.open(view, invokingElement);
    }
}

export const utilityPanel = new UtilityPanelStore();
