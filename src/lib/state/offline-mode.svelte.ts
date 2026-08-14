import type { ConnectivityEvent, ConnectivityState } from "$lib/offline/connectivity";
import { catalogReadRuntime } from "$lib/offline/read-mode-runtime";
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
    }

    get preference() {
        return settings.downloadedOnly ? "downloaded-only" as const : "auto" as const;
    }

    get effective() {
        return catalogReadRuntime.effective;
    }

    setDownloadedOnly(value: boolean) {
        settings.downloadedOnly = value;
        catalogReadRuntime.setPreference(value ? "downloaded-only" : "auto");
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
