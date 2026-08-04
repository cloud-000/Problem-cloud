import Launcher from "./coach-launcher.svelte";
import Panel from "./coach-panel.svelte";
import QuickAsk from "./coach-quick-ask.svelte";
import ContextRegister from "./coach-context-register.svelte";
import ModelPicker from "./coach-model-picker.svelte";
import ConversationList from "./coach-conversation-list.svelte";
import ConversationRow from "./coach-conversation-row.svelte";

export {
    Launcher,
    Panel,
    QuickAsk,
    ContextRegister,
    ModelPicker,
    ConversationList,
    ConversationRow,
    Launcher as CoachLauncher,
    Panel as CoachPanel,
    QuickAsk as CoachQuickAsk,
    ContextRegister as CoachContextRegister,
    ModelPicker as CoachModelPicker,
    ConversationList as CoachConversationList,
    ConversationRow as CoachConversationRow,
};
export type { CoachLauncherProps } from "./coach-launcher.svelte";
export type { CoachQuickAskProps } from "./coach-quick-ask.svelte";
export type { CoachContextRegisterProps } from "./coach-context-register.svelte";
