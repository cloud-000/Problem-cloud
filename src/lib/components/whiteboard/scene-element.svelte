<script lang="ts">
    import type { SceneElement } from "$lib/asy/scene";
    import { arcD, pathD, penStroke, type Project } from "./svg";

    let {
        element,
        project,
        scale,
        selected = false,
    }: {
        element: SceneElement;
        /** asy-space -> screen px (with y-flip). */
        project: Project;
        /** px per asy unit (for circle radius / dot size). */
        scale: number;
        selected?: boolean;
    } = $props();

    const style = $derived(penStroke(element.pen));
    const selectStroke = "var(--color-primary)";
</script>

{#if element.kind === "path"}
    <path
        d={pathD(element.path, project)}
        fill="none"
        stroke={style.stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.dasharray}
        stroke-opacity={style.opacity}
        stroke-linejoin="round"
        stroke-linecap="round"
    />
    {#if selected}
        <path d={pathD(element.path, project)} fill="none" stroke={selectStroke} stroke-width={style.strokeWidth + 3} stroke-opacity="0.25" stroke-linejoin="round" stroke-linecap="round" />
    {/if}
{:else if element.kind === "fill"}
    {@const fill = penStroke(element.pen)}
    <path
        d={pathD(element.path, project)}
        fill={fill.stroke}
        fill-opacity={element.pen?.opacity ?? 0.85}
        stroke={element.drawPen ? penStroke(element.drawPen).stroke : "none"}
        stroke-width={element.drawPen ? penStroke(element.drawPen).strokeWidth : 0}
    />
{:else if element.kind === "circle"}
    {@const c = project(element.center)}
    <circle
        cx={c[0]}
        cy={c[1]}
        r={element.radius * scale}
        fill="none"
        stroke={selected ? selectStroke : style.stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.dasharray}
        stroke-opacity={style.opacity}
    />
{:else if element.kind === "arc"}
    <path
        d={arcD(element.center, element.radius, element.angle1, element.angle2, project)}
        fill="none"
        stroke={selected ? selectStroke : style.stroke}
        stroke-width={style.strokeWidth}
        stroke-dasharray={style.dasharray}
        stroke-linecap="round"
    />
{:else if element.kind === "dot"}
    {@const d = project(element.at)}
    <circle cx={d[0]} cy={d[1]} r={selected ? 5 : 3.5} fill={selected ? selectStroke : style.stroke} />
{:else if element.kind === "label"}
    {@const l = project(element.at)}
    <text
        x={l[0]}
        y={l[1]}
        fill={selected ? selectStroke : style.stroke}
        font-size="14"
        text-anchor="middle"
        dominant-baseline="middle"
        class="select-none"
    >{element.text.replaceAll("$", "")}</text>
{/if}
