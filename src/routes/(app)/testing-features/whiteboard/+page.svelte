<script lang="ts">
    import { Whiteboard, WhiteboardToolbar, WhiteboardPropertyCard, WhiteboardCommandCard } from "$lib/components/whiteboard";
    import { WhiteboardStore } from "$lib/state/whiteboard.svelte";

    const store = new WhiteboardStore();

    const SAMPLE = `pair A=(-2,-1); pair B=(2,-1); pair C=(0,2);
draw(A--B--C--cycle, blue+linewidth(1.5));
dot(A); dot(B); dot(C);
label("$A$", A, SW);
label("$B$", B, SE);
label("$C$", C, N);
draw(circle((0,0), 1), red+dashed);`;

    let asyOut = $state("");

    function loadSample() {
        store.loadAsy(SAMPLE);
    }
    function dumpAsy() {
        asyOut = store.toAsy();
    }
</script>

<div class="flex h-full flex-col gap-3 p-4">
    <div class="flex items-center justify-between gap-2">
        <div>
            <h1 class="text-lg font-semibold">Whiteboard</h1>
            <p class="text-sm text-muted-foreground">
                Sketch surface with Asymptote round-trip. Draw, then copy asy; or load asy and edit it.
            </p>
        </div>
        <div class="flex gap-2">
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={loadSample}>Load sample asy</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => store.loadAsy("draw(arc((0,0), 2, 0, 90));")}>Load Arc</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => store.loadAsy("draw(arc((0,0), 2, 0, 90));\ndraw((-2,2)--(2,2));")}>Load Arc + Line</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => store.loadAsy("draw(arc((0,0), 2, 0, 90));\ndot((1,3));")}>Load Arc + Point</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => {
                    const doc = store.document;
                    const arc = Object.values(doc.sketch.curves).find((c) => c.kind === "arc");
                    const seg = Object.values(doc.sketch.curves).find((c) => c.kind === "segment");
                    if (arc && seg) {
                        store.featureSelection = [
                            { kind: "curve", curveId: arc.id },
                            { kind: "curve", curveId: seg.id },
                        ];
                    }
                }}>Select Arc+Line Features</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => {
                    const doc = store.document;
                    const arc = Object.values(doc.sketch.curves).find((c) => c.kind === "arc");
                    const point = Object.values(doc.sketch.points).find(
                        (p) => p.id !== arc?.center && p.id !== arc?.start && p.id !== arc?.end,
                    );
                    if (arc && point) {
                        store.featureSelection = [
                            { kind: "point", pointId: point.id },
                            { kind: "curve", curveId: arc.id },
                        ];
                    }
                }}>Select Point+Arc Features</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => store.applyRelation("tangent")}>Apply Tangent</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={() => store.applyRelation("point-on-curve")}>Apply Point-on-curve</button
            >
            <button
                class="rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
                onclick={dumpAsy}>Show asy →</button
            >
        </div>
    </div>

    <div class="flex items-start gap-2">
        <WhiteboardToolbar {store} />
        <WhiteboardCommandCard {store} />
        <WhiteboardPropertyCard {store} />
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <div class="min-h-0 overflow-hidden rounded-xl border border-border/60">
            <Whiteboard {store} />
        </div>
        <div class="flex min-h-0 flex-col rounded-xl border border-border/60 bg-surface-container-low/40">
            <div class="border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                Serialized Asymptote
            </div>
            <pre class="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{asyOut ||
                    "Press “Show asy” to serialize the current scene."}</pre>
        </div>
    </div>
</div>
