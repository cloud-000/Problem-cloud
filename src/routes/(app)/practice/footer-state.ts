export type FooterMode = "test" | "historical" | "submitted" | "answering";

export type FooterViewState = {
    mode: FooterMode;
    compact: boolean;
    showBack: boolean;
    backDisabled: boolean;
    showForward: boolean;
    forwardDisabled: boolean;
};

export function deriveFooterViewState(input: {
    gradeImmediately: boolean;
    isLatest: boolean;
    submitted: boolean;
    paused: boolean;
    focusMode: boolean;
    canGoBack: boolean;
}): FooterViewState {
    const mode: FooterMode = !input.gradeImmediately
        ? "test"
        : !input.isLatest
          ? "historical"
          : input.submitted
            ? "submitted"
            : "answering";
    return {
        mode,
        compact: input.focusMode,
        showBack: !input.focusMode || input.canGoBack,
        backDisabled: !input.canGoBack || (input.gradeImmediately && input.paused),
        showForward:
            mode === "test"
                ? !input.isLatest
                : mode === "historical" || mode === "answering",
        forwardDisabled:
            input.paused || (mode === "answering" && input.isLatest && input.submitted),
    };
}
