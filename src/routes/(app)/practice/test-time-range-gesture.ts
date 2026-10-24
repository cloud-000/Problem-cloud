export const TIME_RANGE_HOLD_MS = 500;
const MOVEMENT_TOLERANCE = 12;

type TouchPoint = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;
type HoldClock = {
    schedule: (callback: () => void, ms: number) => () => void;
};

/** Local to test review: never captures a pointer or prevents scrolling. */
export function timeRangeGesture(
    onEndpoint: (index: number) => void,
    onHolding: (index: number | null) => void,
    clock: HoldClock = {
        schedule(callback, ms) {
            const timer = setTimeout(callback, ms);
            return () => clearTimeout(timer);
        },
    },
) {
    let cancelTimer: (() => void) | undefined;
    let pointer: TouchPoint | null = null;
    let suppressedIndex: number | null = null;

    function cancel() {
        cancelTimer?.();
        cancelTimer = undefined;
        pointer = null;
        onHolding(null);
    }

    return {
        cancel,
        down(event: TouchPoint & Pick<PointerEvent, "pointerType" | "isPrimary">, index: number) {
            cancel();
            suppressedIndex = null;
            if (event.pointerType !== "touch" || !event.isPrimary) return;
            pointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
            onHolding(index);
            cancelTimer = clock.schedule(() => {
                cancelTimer = undefined;
                onHolding(null);
                suppressedIndex = index;
                onEndpoint(index);
            }, TIME_RANGE_HOLD_MS);
        },
        move(event: TouchPoint) {
            if (!pointer || pointer.pointerId !== event.pointerId) return;
            if (Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > MOVEMENT_TOLERANCE) cancel();
        },
        consumeClick(index: number) {
            const suppressed = suppressedIndex === index;
            suppressedIndex = null;
            return suppressed;
        },
        resetClick() { suppressedIndex = null; },
        preventContextMenu(index: number) { return pointer !== null || suppressedIndex === index; },
    };
}
