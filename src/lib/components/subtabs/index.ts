import Root, {
    type SubtabsProps,
    SUBTABS_CONTEXT_KEY,
    useSubtabs,
    type SubtabsContext,
} from "./subtabs.svelte";
import List from "./subtabs-list.svelte";
import Trigger, {
    type SubtabsTriggerProps,
} from "./subtabs-trigger.svelte";
import Content, {
    type SubtabsContentProps,
} from "./subtabs-content.svelte";

// Define a type representing the compound component type
type SubtabsComponent = typeof Root & {
    List: typeof List;
    Trigger: typeof Trigger;
    Content: typeof Content;
};

// Cast Root and attach the sub-components
const Subtabs = Root as unknown as SubtabsComponent;
Subtabs.List = List;
Subtabs.Trigger = Trigger;
Subtabs.Content = Content;

export {
    Subtabs as Root,
    List,
    Trigger,
    Content,
    // Aliases
    Subtabs,
    List as SubtabsList,
    Trigger as SubtabsTrigger,
    Content as SubtabsContent,
    // Prop Types & Helpers
    type SubtabsProps,
    type SubtabsTriggerProps,
    type SubtabsContentProps,
    type SubtabsContext,
    SUBTABS_CONTEXT_KEY,
    useSubtabs,
};
export default Subtabs;
