<script lang="ts">
   import * as Sidebar from "$lib/components/sidebar";
   import { ToastContainer } from "$lib/components/toast";
   import { ModalContainer } from "$lib/components/modal";
   import { page } from "$app/state";
   import { enhance } from "$app/forms";
   import { Icon } from "$lib/components/icon/.";
   import { cn } from "$lib/utils.js";
   import { toasts, type Toast } from "$lib/state/toast.svelte";
   import {
      fetchUnread,
      subscribeToNotifications,
      markRead,
      toToast,
   } from "$lib/notifications";
   import {
      DropdownMenu,
      type DropdownOption,
   } from "$lib/components/dropdown-menu";
   import { deviceDetails } from "$lib/mobile.svelte";
   import { goto } from "$app/navigation";
   import { topbar } from "$lib/state/topbar.svelte";
   import { shell } from "$lib/state/shell.svelte";
   import { settings } from "$lib/state/settings.svelte";
   import {
      CoachContextRegister,
      CoachLauncher,
      CoachPanel,
      CoachQuickAsk,
   } from "$lib/components/coach";
   import { routeLabel } from "$lib/ai/route-context";
   import {
      UtilityPanel,
      UtilityPanelRegister,
   } from "$lib/components/utility-panel";
   import { coach } from "$lib/state/coach.svelte";
   import { utilityPanel } from "$lib/state/utility-panel.svelte";
   import { resolve } from "$app/paths";
   import { MediaQuery } from "svelte/reactivity";
   import { onMount } from "svelte";
   import { setAppScrollViewport } from "$lib/components/virtual-list";
   import {
      loadSidebarExpanded,
      saveSidebarExpanded,
   } from "$lib/sidebar-persistence";
   import { modal } from "$lib/state/modal.svelte";
   import FeedbackModal from "./settings/FeedbackModal.svelte";

   let { data, children } = $props();
   let { supabase, session, user, profile } = $derived(data);
   let aiCoachEnabled = $derived(Boolean(data.aiCoachEnabled && session));
   let coachFabVisible = $derived(
      aiCoachEnabled &&
         coach.enabled &&
         shell.coachLauncherVisible &&
         utilityPanel.activeView === null,
   );
   let appScrollViewport = $state<HTMLElement | null>(null);
   setAppScrollViewport({ getElement: () => appScrollViewport });

   $effect(() => {
      coach.configure(aiCoachEnabled);
      coach.configureContextResolver(supabase, user?.id);
   });

   // Surface notifications as toasts for authenticated users: replay unread ones on
   // load, then stream new inserts in real time. Auto-dismiss leaves them unread; only
   // an explicit close persists a read record (see markRead below).
   $effect(() => {
      if (!user) return;
      const userId = user.id;

      fetchUnread(supabase, userId).then((rows) => {
         for (const row of rows) toasts.add(toToast(row));
      });

      const channel = subscribeToNotifications(supabase, userId, (row) => {
         toasts.add(toToast(row));
      });

      return () => {
         supabase.removeChannel(channel);
      };
   });

   // Only DB-backed toasts (with a notificationId) get a persisted read record;
   // client-only toasts dismiss purely on the client.
   function onToastClose(toast: Toast) {
      if (user && toast.notificationId != null)
         markRead(supabase, user.id, toast.notificationId);
   }

   const basePrimaryTabs = [
      { href: "/", icon: "home", label: "Home" },
      { href: "/practice", icon: "sprint", label: "Practice" },
      { href: "/library", icon: "book_5", label: "Library" },
      { href: "/progress", icon: "insights", label: "Progress" },
   ] as const;

   // The Coach's full-screen surface. Deliberately the *only* way in: nothing
   // inside the app escalates into the route, so if the account has no Coach the
   // tab is absent rather than landing on an explanation.
   const coachTab = { href: "/coach", icon: "auto_awesome", label: "Coach" } as const;

   let primaryTabs = $derived(
      aiCoachEnabled ? [...basePrimaryTabs, coachTab] : [...basePrimaryTabs],
   );

   const secondaryTabs = [
      { href: "/whiteboard", icon: "draw", label: "Whiteboard" },
      { href: "/leaderboard", icon: "leaderboard", label: "Leaderboard" },
      { href: "/roadmap", icon: "map", label: "Product roadmap" },
   ] as const;

   // Routes the Coach's context layer can name. Without this its chips read
   // "/library"; the sections outside the nav tabs are listed alongside them so
   // no authenticated route the Coach can see is left as a raw pathname.
   let coachRouteLabels = $derived([
      ...primaryTabs,
      ...secondaryTabs,
      { href: "/find", label: "Find problems" },
      { href: "/history", label: "History" },
      { href: "/settings", label: "Settings" },
      { href: "/admin", label: "Admin tools" },
   ]);

   function routeMatches(pathname: string, href: string) {
      return href === "/"
         ? pathname === "/"
         : pathname === href || pathname.startsWith(`${href}/`);
   }

   function primaryIsActive(href: string) {
      if (href === "/progress") {
         return (
            routeMatches(page.url.pathname, href) ||
            routeMatches(page.url.pathname, "/history")
         );
      }
      if (href === "/library") {
         return (
            routeMatches(page.url.pathname, href) ||
            routeMatches(page.url.pathname, "/find")
         );
      }
      return routeMatches(page.url.pathname, href);
   }
   // Sidebar state
   let expanded = $state(true);
   let sidebarPreferenceLoaded = false;

   onMount(() => {
      expanded = loadSidebarExpanded(localStorage);
      sidebarPreferenceLoaded = true;
   });

   function setSidebarExpanded(value: boolean) {
      expanded = value;
      if (sidebarPreferenceLoaded) {
         saveSidebarExpanded(localStorage, value);
      }
   }

   const portraitQuery = new MediaQuery("(orientation: portrait)", false);
   let isPortrait = $derived(portraitQuery.current);

   const isMobilePortrait = $derived(deviceDetails.isMobile && isPortrait);

   // A route with its own mobile bottom bar (the trainer) takes the nav's place
   // rather than stacking on top of it.
   const showNav = $derived(!isMobilePortrait || shell.mobileNavVisible);

   // Reference to the logout form so we can programmatically submit it on mobile portrait dropdown clicks
   let logoutForm = $state<HTMLFormElement | null>(null);

   function openFeedback() {
      if (!user) return;
      modal.show(
         FeedbackModal,
         { supabase, user },
         { title: "Send feedback", size: "md" },
      );
   }

   function addAccountOptions(list: DropdownOption[]) {
      if (profile) {
         list.push({ label: profile.username || "User", type: "header" });
      }
      if (session?.user?.email) {
         list.push({ label: session.user.email, type: "header" });
      }
      if (profile || session?.user?.email) list.push({ type: "divider" });

      list.push({
         label: "Settings",
         icon: "settings",
         onclick: () => goto(resolve("/settings")),
      });
      if (user) {
         list.push({
            label: "Send feedback",
            icon: "feedback",
            onclick: openFeedback,
         });
      }
      if ((profile?.admin_rank ?? 0) > 0) {
         list.push({ type: "divider" });
         list.push({
            label: "Admin tools",
            icon: "admin_panel_settings",
            onclick: () => goto(resolve("/admin")),
         });
      }
      if (settings.showBetaFeatures) {
         list.push({
            label: "Developer tools",
            icon: "labs",
            onclick: () => goto(resolve("/testing-features")),
         });
      }
      if (session) {
         list.push({ type: "divider" });
         list.push({
            label: "Log out",
            icon: "logout",
            color: "text-destructive",
            onclick: () => logoutForm?.requestSubmit(),
         });
      }
   }

   let secondaryOptions = $derived.by<DropdownOption[]>(() =>
      secondaryTabs.map((tab) => ({
         label: tab.label,
         icon: tab.icon,
         onclick: () => goto(resolve(tab.href)),
      })),
   );

   // Mobile More also owns account access because there is no separate profile
   // control in the compact bottom navigation.
   let mobileMoreOptions = $derived.by<DropdownOption[]>(() => {
      const list: DropdownOption[] = [];
      list.push(...secondaryOptions, { type: "divider" });
      addAccountOptions(list);
      return list;
   });

   let isMoreActive = $derived(
      secondaryTabs.some((tab) => routeMatches(page.url.pathname, tab.href)),
   );
   let isProfileActive = $derived(
      routeMatches(page.url.pathname, "/settings") ||
         routeMatches(page.url.pathname, "/admin") ||
         routeMatches(page.url.pathname, "/testing-features"),
   );

   let profileOptions = $derived.by<DropdownOption[]>(() => {
      const list: DropdownOption[] = [];
      addAccountOptions(list);
      return list;
   });

   // The Coach's chord lives here rather than on a launcher, so suppressing the
   // button on one route can't kill the shortcut there. `shell.coachAvailable`
   // carries route-local rules the layout can't see (the trainer's mid-test lock).
   function handleCoachShortcut(event: KeyboardEvent) {
      if (!aiCoachEnabled || event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "j")
         return;
      if (!shell.coachAvailable) return;
      event.preventDefault();
      coach.toggleQuickAsk(document.activeElement as HTMLElement | null);
   }
</script>

<svelte:window onkeydown={handleCoachShortcut} />

{#snippet sidebarLink(
   href: string,
   icon: string,
   label: string,
   isActive: boolean,
)}
   <Sidebar.Item active={isActive} activeClass="" {label}>
      {#snippet child({ props })}
         <a
            href={resolve(href as "/")}
            {...props}
            aria-current={isActive ? "page" : undefined}
            class={cn(
               "type-secondary relative flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
               isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
               expanded ? "justify-start" : "justify-center px-0 w-10 h-10",
            )}
         >
            <Icon
               fill={isActive}
               class={cn(
                  "shrink-0 transition-colors",
                  isActive && "text-primary-foreground",
               )}
            >
               {icon}
            </Icon>
            {#if expanded}
               <span class="truncate transition-opacity duration-200"
                  >{label}</span
               >
            {/if}
         </a>
      {/snippet}
   </Sidebar.Item>
{/snippet}

<div
   class="app-container flex flex-row w-full h-dvh bg-background text-foreground overflow-hidden"
>
   {#if showNav}
      <Sidebar.Root
         bind:expanded={() => expanded, setSidebarExpanded}
         class={expanded ? "w-60" : "w-16"}
      >
         <Sidebar.Header
            class={cn(
               "border-b-0 px-3 py-3",
               expanded ? "justify-between" : "justify-center",
            )}
         >
            {#if expanded}
               <a
                  href={resolve("/")}
                  class="type-secondary flex min-h-10 items-center gap-2 rounded-md px-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="ProblemCloud home"
               >
                  <Icon class="text-primary-foreground" fontsize="24px"
                     >cloud</Icon
                  >
                  <span class="font-semibold">ProblemCloud</span>
               </a>
            {/if}
            <Sidebar.Trigger />
         </Sidebar.Header>

         <Sidebar.Group class="gap-1 px-2 py-3">
            {#if isMobilePortrait}
               {#each primaryTabs as tab (tab.href)}
                  {@const isActive = primaryIsActive(tab.href)}
                  {@render sidebarLink(tab.href, tab.icon, tab.label, isActive)}
               {/each}
               <Sidebar.Item
                  active={isMoreActive || isProfileActive}
                  activeClass=""
                  label="More"
               >
                  {#snippet child({ props })}
                     <DropdownMenu
                        options={mobileMoreOptions}
                        class="w-full h-full"
                        triggerClass="w-full h-full flex items-center justify-center"
                     >
                        <button
                           type="button"
                           {...props}
                           class={cn(
                              props.class,
                              isMoreActive || isProfileActive
                                 ? "bg-primary text-primary-foreground"
                                 : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
                              "justify-center px-0 w-10 h-10",
                           )}
                           aria-label="More"
                        >
                           <Icon
                              fill={isMoreActive || isProfileActive}
                              class="shrink-0 transition-colors"
                           >
                              more_horiz
                           </Icon>
                        </button>
                     </DropdownMenu>
                  {/snippet}
               </Sidebar.Item>
            {:else}
               {#each primaryTabs as tab (tab.href)}
                  {@const isActive = primaryIsActive(tab.href)}
                  {@render sidebarLink(tab.href, tab.icon, tab.label, isActive)}
               {/each}
               <Sidebar.Item active={isMoreActive} activeClass="" label="More">
                  {#snippet child({ props })}
                     <DropdownMenu
                        options={secondaryOptions}
                        class="w-full"
                        triggerClass="w-full"
                     >
                        <button
                           type="button"
                           {...props}
                           class={cn(
                              props.class,
                              "type-secondary relative flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              isMoreActive
                                 ? "bg-primary text-primary-foreground"
                                 : "text-muted-foreground hover:bg-surface-container hover:text-foreground",
                              expanded
                                 ? "justify-start"
                                 : "h-10 w-10 justify-center px-0",
                           )}
                           aria-label="More"
                        >
                           <Icon
                              name="more_horiz"
                              fill={isMoreActive}
                              class={cn(
                                 isMoreActive && "text-primary-foreground",
                              )}
                           />
                           {#if expanded}<span>More</span>{/if}
                        </button>
                     </DropdownMenu>
                  {/snippet}
               </Sidebar.Item>
            {/if}
         </Sidebar.Group>

         <Sidebar.Footer class="border-t border-border/50 p-2">
            {#if session}
               {#if !isMobilePortrait}
                  <DropdownMenu
                     options={profileOptions}
                     class="w-full"
                     triggerClass="w-full"
                  >
                     <button
                        type="button"
                        class={cn(
                           "flex min-h-11 w-full items-center gap-3 rounded-md p-2 text-left outline-none transition-colors hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-ring",
                           expanded ? "justify-start" : "justify-center",
                           isProfileActive && "bg-surface-container-high",
                        )}
                        aria-label="Profile menu"
                     >
                        <span
                           class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold"
                        >
                           {profile?.username?.charAt(0).toUpperCase() || "U"}
                        </span>
                        {#if expanded}
                           <span class="min-w-0 flex-1">
                              <span
                                 class="type-secondary block truncate font-medium text-foreground"
                              >
                                 {profile?.username || "Your profile"}
                              </span>
                              <span
                                 class="type-caption block truncate text-muted-foreground"
                              >Account and settings</span>
                           </span>
                           <Icon name="more_horiz" class="text-muted-foreground" />
                        {/if}
                     </button>
                  </DropdownMenu>
               {/if}
            {:else}
               <Sidebar.Item
                  href="/auth/login"
                  icon="login"
                  label="Log In"
                  active={page.url.pathname === "/auth/login"}
               />
            {/if}
         </Sidebar.Footer>
      </Sidebar.Root>
   {/if}

   {#if session}
      <form
         bind:this={logoutForm}
         action="/auth/logout"
         method="POST"
         use:enhance
         class="hidden"
      ></form>
   {/if}

   <div class="flex flex-col flex-1 h-full overflow-hidden">
      {#if topbar.visible}
         <div
            class="relative z-40 flex h-12 shrink-0 items-center justify-between gap-x-3 gap-y-2 border-b border-border/50 px-2 select-none"
         >
            <div
               class="absolute inset-0 bg-background backdrop-blur-(--backdrop-blur) -z-10"
            ></div>
            {#if topbar.leftSnippet}
               {@render topbar.leftSnippet()}
            {:else}
               <div class="flex items-center gap-2">
                  {#if topbar.backHref}
                     <a
                        href={resolve(topbar.backHref as "/")}
                        class="inline-flex items-center rounded-md h-8 px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label={topbar.backLabel || "Back"}
                     >
                        <Icon name="arrow_back" class="size-5" />
                     </a>
                  {/if}
                  {#if topbar.title}
                     <h1 class="text-sm font-semibold">
                        {topbar.title}
                     </h1>
                  {/if}
               </div>
            {/if}

            <div class="flex items-center gap-3">
               {#if topbar.rightSnippet}
                  {@render topbar.rightSnippet()}
               {/if}

            </div>
         </div>
      {/if}
      <div
         bind:this={appScrollViewport}
         class="flex-1 overflow-y-auto overscroll-contain p-0"
      >
         {@render children()}
      </div>
   </div>

   {#if aiCoachEnabled}
      <UtilityPanelRegister
         view="coach"
         ownerId="app-shell:coach"
         label="Coach"
         sizing={{
            width: {
               default: 400,
               min: 320,
               max: Number.POSITIVE_INFINITY,
            },
            mobileHeight: {
               defaultRatio: 0.5,
               minRatio: 0.35,
               maxRatio: 0.9,
            },
         }}
      >
         <CoachPanel />
      </UtilityPanelRegister>
      {#key page.url.pathname}
         <CoachContextRegister
            ownerId={`route:${page.url.pathname}`}
            source="route"
            priority={10}
            policy="assist"
            descriptors={[
               {
                  id: `route:${page.url.pathname}`,
                  label: routeLabel(page.url.pathname, coachRouteLabels),
                  ref: {
                     kind: "selection",
                     text: `Current app area: ${routeLabel(page.url.pathname, coachRouteLabels)}`,
                  },
               },
            ]}
            quickActions={[]}
         />
      {/key}
      <!-- Mounted once, hidden while any utility view is open (§6.4). -->
      <CoachQuickAsk />
      <CoachLauncher />
   {/if}
   <UtilityPanel />

   <ToastContainer
      onDismiss={onToastClose}
      class={cn(
         utilityPanel.activeView && "utility-panel-toast-offset z-70",
         coachFabVisible && "coach-fab-toast-offset",
      )}
      style={`--utility-panel-width: ${utilityPanel.renderedWidth}px; --utility-panel-height: ${utilityPanel.renderedHeight}px`}
   />
   <ModalContainer />
</div>

<style>
   @media (min-width: 1280px) {
      :global(.utility-panel-toast-offset) {
         right: calc(var(--utility-panel-width) + 1rem);
      }
   }

   :global(.coach-fab-toast-offset) {
      bottom: 4.5rem;
   }

   @media (max-width: 767px) and (orientation: portrait) {
      :global(.utility-panel-toast-offset) {
         bottom: calc(var(--utility-panel-height) + 1rem);
      }

      :global(.coach-fab-toast-offset) {
         bottom: calc(56px + env(safe-area-inset-bottom) + 4.5rem);
      }
   }

   @media (orientation: portrait) {
      @scope (.is-mobile) {
         .app-container {
            flex-direction: column-reverse !important;
         }

         :global([data-slot="sidebar-root"]) {
            flex-direction: row !important;
            align-items: center !important;
            width: 100% !important;
            /* Grow the bar by the bottom safe-area inset (home indicator /
                   Safari toolbar) so the 56px of interactive content sits above it. */
            height: calc(56px + env(safe-area-inset-bottom)) !important;
            border-right-width: 0px !important;
            border-top: 1px solid var(--color-border) !important;
            overflow-x: auto !important;
            scrollbar-width: none !important;
            padding: 0 8px env(safe-area-inset-bottom) 8px !important;
            background-color: var(--color-surface-container-low) !important;
         }

         :global([data-slot="sidebar-root"])::-webkit-scrollbar {
            display: none !important;
         }

         :global([data-slot="sidebar-header"]) {
            display: none !important;
         }

         :global([data-slot="sidebar-group"]) {
            flex-direction: row !important;
            padding: 0 !important;
            margin: 0 !important;
            width: auto !important;
            flex-shrink: 0 !important;
         }

         :global([data-slot="sidebar-group-content"]) {
            flex-direction: row !important;
            align-items: center !important;
            gap: 4px !important;
            flex-shrink: 0 !important;
         }

         :global([data-slot="sidebar-footer"]) {
            flex-direction: row !important;
            margin-top: 0 !important;
            border-top-width: 0px !important;
            padding: 0 8px 0 0 !important;
            align-items: center !important;
            gap: 4px !important;
            flex-shrink: 0 !important;
            margin-left: auto !important;
         }

         :global([data-slot="sidebar-item"]) span {
            display: none !important;
         }

         :global([data-slot="sidebar-item"]) {
            width: 44px !important;
            height: 44px !important;
            padding: 0 !important;
            justify-content: center !important;
            align-items: center !important;
            flex-shrink: 0 !important;
         }

         :global([data-slot="sidebar-item"] a) {
            width: 40px !important;
            height: 40px !important;
            padding: 0 !important;
            justify-content: center !important;
            align-items: center !important;
            flex-shrink: 0 !important;
         }
      }
   }
</style>
