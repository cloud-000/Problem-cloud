import { browser } from "$app/environment";
import type { ConnectivityEvent, ConnectivityState } from "$lib/offline/connectivity";
import { catalogReadRuntime } from "$lib/offline/read-mode-runtime";
import { effectiveReadMode, type EffectiveReadMode, type OfflinePreference } from "$lib/offline/mode";
import { settings } from "./settings.svelte";

class OfflineModeStore {
    connectivity = $state<ConnectivityState>("online");
    lastLocalRead = $state(false);

    constructor() {
        catalogReadRuntime.setPreference(settings.downloadedOnly ? "downloaded-only" : "auto");
        catalogReadRuntime.subscribe((value) => {
            this.connectivity = value.connectivity;
            this.lastLocalRead = value.lastLocalRead;
        });

        if (browser) {
            const handleOnline = () => {
                this.dispatch({ type: "browser-online" });
                this.noteRemoteSuccess();
            };
            const handleOffline = () => {
                this.dispatch({ type: "browser-offline" });
            };

            window.addEventListener("online", handleOnline);
            window.addEventListener("offline", handleOffline);

            if (!navigator.onLine) {
                handleOffline();
            } else if (!settings.downloadedOnly) {
                this.noteRemoteSuccess();
            }
        }
    }

    get preference(): OfflinePreference {
        return settings.downloadedOnly ? "downloaded-only" : "auto";
    }

    get downloadedOnly(): boolean {
        return settings.downloadedOnly;
    }

    set downloadedOnly(value: boolean) {
        this.setDownloadedOnly(value);
    }

    get effective(): EffectiveReadMode {
        return effectiveReadMode(this.preference, this.connectivity);
    }

    get isLocal(): boolean {
        return this.effective === "local";
    }

    get isOffline(): boolean {
        return this.connectivity === "offline";
    }

    setDownloadedOnly(value: boolean) {
        settings.downloadedOnly = value;
        catalogReadRuntime.setPreference(value ? "downloaded-only" : "auto");
        if (!value && typeof navigator !== "undefined" && navigator.onLine) {
            this.noteRemoteSuccess();
        }
    }

    dispatch(event: ConnectivityEvent) {
        catalogReadRuntime.dispatch(event);
    }

    noteRemoteSuccess() {
        catalogReadRuntime.noteRemoteSuccess();
    }

    noteRemoteFailure() {
        catalogReadRuntime.noteRemoteFailure();
    }

    noteLocalRead() {
        catalogReadRuntime.noteLocalRead();
    }
}

export const offlineMode = new OfflineModeStore();


