import Root, {
    type SidebarProps,
    type SidebarContext,
    SIDEBAR_CONTEXT_KEY,
    useSidebar,
} from "./sidebar.svelte";
import Header from "./sidebar-header.svelte";
import Group from "./sidebar-group.svelte";
import Item, {
    type SidebarItemProps,
    sidebarItemVariants,
} from "./sidebar-item.svelte";
import Footer from "./sidebar-footer.svelte";
import Trigger from "./sidebar-trigger.svelte";

export {
    Root,
    Header,
    Group,
    Item,
    Footer,
    Trigger,
    //
    Root as Sidebar,
    Header as SidebarHeader,
    Group as SidebarGroup,
    Item as SidebarItem,
    Footer as SidebarFooter,
    Trigger as SidebarTrigger,
    // Types & helpers
    type SidebarProps,
    type SidebarItemProps,
    type SidebarContext,
    SIDEBAR_CONTEXT_KEY,
    useSidebar,
    sidebarItemVariants,
};
