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
            /*new Theme("plain", {
                "c bg": "rgb(255, 255, 255)",
                "c bg m": "rgb(244, 246, 248)",
                "c text": "rgb(9, 9, 11)",
                "c text2": "rgb(113, 113, 122)",
                "c bd": "rgb(208, 217, 224)",
                "c shadow": "rgb(103 103 120 / 30%)",
                "c accent": "rgb(50, 108, 236)",
                "c accent bg": "rgb(219, 233, 254)",
            }),*/
            new Theme("plain", {
                background: "rgb(255, 255, 255)",
                // "c bg m": "rgb(244, 246, 248)",
                foreground: "rgb(9, 9, 11)",
                secondary: "rgb(113, 113, 122)",
                border: "rgb(208, 217, 224)",
                // "c shadow": "rgb(103 103 120 / 30%)",

                "primary foreground": "rgb(50, 108, 236)",
                primary: "rgb(219, 233, 254)",

                accent: "oklch(0.97 0 0)",
            }),
        );

        app.addTheme(
            /*new Theme("dark", {
                "c bg": "rgb(57 63 75)",
                "c bg m": "rgb(46 51 60)",
                "c text": "rgb(200 204 211)",
                "c text2": "rgb(107 112 124)",
                "c bd": "rgb(54 57 62)",
                "c shadow": "rgb(200 204 211)",
                "c accent": "rgb(64 134 232)",
                "c accent bg": "rgb(169 186 230)",
            }),*/
            new Theme("dark", {
                background: "rgb(57 63 75)",
                // "c bg m": "rgb(46 51 60)",
                foreground: "rgb(200 204 211)",
                // secondary: "green",
                // "secondary foreground": "rgb(107 112 124)",
                border: "rgb(100, 110, 120)",

                "primary foreground": "rgb(110 160 230) ",
                primary: "color-mix(in srgb, rgb(34 121 250) 20%, transparent)",
                accent: "rgb(70 75 88)",
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
