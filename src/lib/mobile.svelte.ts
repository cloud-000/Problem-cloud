// lib/mobile.svelte.js
export let deviceDetails = $state({
    isMobile: false,
});

if (typeof window !== "undefined") {
    const urlParams = new URLSearchParams(window.location.search);
    const forceMobile = urlParams.get("preview") === "mobile";

    const media = window.matchMedia("(pointer: none) or (pointer: coarse)");
    deviceDetails.isMobile = media.matches || forceMobile;

    media.addEventListener("change", (e) => {
        deviceDetails.isMobile = e.matches;
    });
}
