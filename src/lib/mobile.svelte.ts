import { browser } from "$app/environment";
import { Theme } from "$lib/utils/Theme.svelte.js";

export let deviceDetails = $state({
    isMobile: false,
    isKindle: false,
});

if (browser) {
    const urlParams = new URLSearchParams(window.location.search);
    const forceMobile = urlParams.get("preview") === "mobile";
    const forceKindle =
        urlParams.get("preview") === "kindle" ||
        urlParams.get("kindle") === "true";

    const media = window.matchMedia("(pointer: none) or (pointer: coarse)");
    deviceDetails.isMobile = media.matches || forceMobile;

    media.addEventListener("change", (e) => {
        deviceDetails.isMobile = e.matches;
    });

    const ua = navigator.userAgent || "";
    const isKindleUA =
        /kindle|silk|kftt|kfot|kfjwa|kfjwi|kfsowi|kfthwi|kfapwi|kobo|nook|paperwhite|eink/i.test(
            ua,
        );
    const isSlowUpdateMedia =
        window.matchMedia("(update: slow)")?.matches ?? false;

    deviceDetails.isKindle = isKindleUA || isSlowUpdateMedia || forceKindle;

    // Auto-switch to kindle theme if Kindle/E-Ink is detected and no theme preference was saved
    if (deviceDetails.isKindle) {
        try {
            const saved = localStorage.getItem("theme");
            if (!saved) {
                Theme.theme = "kindle";
            }
        } catch (_) {}
    }
}
