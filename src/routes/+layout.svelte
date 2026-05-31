<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import "$lib/global.css";
    import { setAppState, AppState } from "$lib/appState.svelte";
    import { onMount } from "svelte";
    import {
        PUBLIC_TEST_EMAIL,
        PUBLIC_TEST_PASSWORD,
    } from "$env/static/public";
    import { deviceDetails } from "$lib/deviceDetails.svelte";
    import { Theme } from "$lib/utils/Theme";
    import { getRating } from "$lib/db/supabaseClient.js";

    // import { setUserSession } from "$lib/user.svelte";
    let { data: pData, children } = $props();

    const app = setAppState(new AppState());

    console.log("Hello from +layout.svelte");

    if (!pData.data.user) {
        console.log("Not Signed In");

        (async () => {
            let { data } = await pData.supabase.auth.signInWithPassword({
                email: PUBLIC_TEST_EMAIL,
                password: PUBLIC_TEST_PASSWORD,
            });

            console.log(data);
            console.log("HIII");
        })();
    } else {
        app.username = pData.data.user?.user_metadata.username;
        app.uuid = pData.data.user?.user_metadata.sub;
        app.email = pData.data.user?.email;

        // app.username = pData.data.user.id
    }

    (async () => {
        app.rating = await getRating(pData.supabase, app.uuid);
    })();

    onMount(() => {
        console.log(`This should only run once ${Date.now()}`);
        Theme.init();

        app.addTheme(
            new Theme("plain", {
                background: "rgb(255, 255, 255)",
                foreground: "rgb(9, 9, 11)",
                card: "rgb(255, 255, 255)",
                "card foreground": "rgb(9, 9, 11)",
                popover: "rgb(255, 255, 255)",
                "popover foreground": "rgb(9, 9, 11)",
                primary: "rgb(219, 233, 254)",
                "primary foreground": "rgb(50, 108, 236)",
                secondary: "rgb(244, 244, 245)",
                "secondary foreground": "rgb(24, 24, 27)",
                muted: "rgb(244, 244, 245)",
                "muted foreground": "rgb(113, 113, 122)",
                accent: "rgb(244, 244, 245)",
                "accent foreground": "rgb(24, 24, 27)",
                destructive: "rgb(239, 68, 68)",
                "destructive foreground": "rgb(250, 250, 250)",
                border: "rgb(228, 228, 231)",
                input: "rgb(228, 228, 231)",
                ring: "rgb(24, 24, 27)",
            }),
        );

        app.addTheme(
            new Theme("dark", {
                background: "rgb(57 63 75)",
                foreground: "rgb(200 204 211)",
                card: "rgb(57 63 75)",
                "card foreground": "rgb(200 204 211)",
                popover: "rgb(57 63 75)",
                "popover foreground": "rgb(200 204 211)",
                primary: "color-mix(in srgb, rgb(34 121 250) 20%, transparent)",
                "primary foreground": "rgb(110 160 230)",
                secondary: "rgb(70 75 88)",
                "secondary foreground": "rgb(200 204 211)",
                muted: "rgb(70 75 88)",
                "muted foreground": "rgb(150 155 168)",
                accent: "rgb(70 75 88)",
                "accent foreground": "rgb(200 204 211)",
                destructive: "rgb(127, 29, 29)",
                "destructive foreground": "rgb(200 204 211)",
                border: "rgb(100, 110, 120)",
                input: "rgb(100, 110, 120)",
                ring: "rgb(110 160 230)",
            }),
        );

        app.theme = "dark";
    });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<main class="expand flex {deviceDetails.isMobile ? 'mobile' : ''}">
    {@render children()}
</main>

<style>
    @media (orientation: portrait) {
        main.mobile {
            flex-direction: column-reverse;
        }
    }

    main {
        flex-direction: row;
        align-items: flex-start;
        justify-content: flex-start;
        overflow: hidden;
    }
</style>
