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
    // Match Amazon Kindle, Silk, Kobo, Nook, Onyx Boox, ReMarkable, E-Ink devices
    const isKindleUA =
        /kindle|silk|kftt|kfot|kfjwa|kfjwi|kfsowi|kfthwi|kfapwi|kobo|nook|paperwhite|eink|boox|onyx|remarkable/i.test(
            ua,
        );

    // CSS Media Query Level 4 update frequency & monochrome checks
    const isSlowUpdateMedia =
        window.matchMedia?.("(update: slow)")?.matches ?? false;
    const isMonochromeMedia =
        window.matchMedia?.("(monochrome)")?.matches ?? false;

    deviceDetails.isKindle =
        isKindleUA || isSlowUpdateMedia || isMonochromeMedia || forceKindle;

    // Auto-switch to kindle theme if Kindle/E-Ink is detected unless user explicitly chose a theme in settings
    if (deviceDetails.isKindle) {
        try {
            const userExplicit = localStorage.getItem("theme:user_explicit");
            if (!userExplicit) {
                Theme.theme = "kindle";
            }
        } catch (_) {}
    }
}
