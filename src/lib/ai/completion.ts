import type { AIFinishReason } from "./types";

/** UI copy only; completion metadata never becomes model-facing text. */
export function completionNotice(reason?: AIFinishReason): string | undefined {
    if (reason === "length") {
        return "Response reached the model's token limit. Ask Coach to continue from where it stopped.";
    }
    if (reason === "other") {
        return "Completion unconfirmed: the provider ended the stream without a recognized stop reason. If the reply looks unfinished, ask Coach to continue.";
    }
    if (reason === "tool-calls") {
        return "Response paused for a tool this connection cannot run. Try asking again without tools.";
    }
}
