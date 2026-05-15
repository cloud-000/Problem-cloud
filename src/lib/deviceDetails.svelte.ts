// lib/mobile.svelte.js
export let deviceDetails = $state({
    isMobile: false,
});

if (typeof window !== "undefined") {
    const media = window.matchMedia("(pointer: none) or (pointer: coarse)");
    deviceDetails.isMobile = media.matches;

    media.addEventListener("change", (e) => {
        deviceDetails.isMobile = e.matches;
    });
}
