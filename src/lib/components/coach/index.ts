import Launcher from "./coach-launcher.svelte";
import Panel from "./coach-panel.svelte";
import QuickAsk from "./coach-quick-ask.svelte";
import ContextRegister from "./coach-context-register.svelte";
import ContextChips from "./coach-context-chips.svelte";
import ModelPicker from "./coach-model-picker.svelte";
import ConversationList from "./coach-conversation-list.svelte";
import ConversationRow from "./coach-conversation-row.svelte";
import Inline from "./coach-inline.svelte";
import ResumePrompt from "./coach-resume-prompt.svelte";

export {
    Launcher,
    Panel,
    QuickAsk,
    ContextRegister,
    ContextChips,
    ModelPicker,
    ConversationList,
    ConversationRow,
    Inline,
    ResumePrompt,
    Launcher as CoachLauncher,
    Panel as CoachPanel,
    QuickAsk as CoachQuickAsk,
    ContextRegister as CoachContextRegister,
    ContextChips as CoachContextChips,
    ModelPicker as CoachModelPicker,
    ConversationList as CoachConversationList,
    ConversationRow as CoachConversationRow,
    Inline as CoachInline,
    ResumePrompt as CoachResumePrompt,
};
export type { CoachLauncherProps } from "./coach-launcher.svelte";
export type { CoachQuickAskProps } from "./coach-quick-ask.svelte";
export type { CoachContextRegisterProps } from "./coach-context-register.svelte";
export type { CoachInlineProps } from "./coach-inline.svelte";
