import type { CoachContextDescriptor, CoachContextLayer, CoachQuickAction } from "./types";

export function upsertContextLayer(
    layers: CoachContextLayer[],
    next: CoachContextLayer,
): CoachContextLayer[] {
    return [...layers.filter((layer) => layer.ownerId !== next.ownerId), next];
}

export function removeContextLayer(
    layers: CoachContextLayer[],
    ownerId: string,
): CoachContextLayer[] {
    return layers.filter((layer) => layer.ownerId !== ownerId);
}

export function orderedContextLayers(layers: CoachContextLayer[]): CoachContextLayer[] {
    return layers.slice().sort((a, b) => b.priority - a.priority);
}

export function activeContextDescriptors(
    layers: CoachContextLayer[],
    detachedIds: ReadonlySet<string> = new Set(),
): CoachContextDescriptor[] {
    const seen = new Set<string>();
    const descriptors: CoachContextDescriptor[] = [];
    for (const layer of orderedContextLayers(layers)) {
        for (const descriptor of layer.descriptors) {
            if (seen.has(descriptor.id) || detachedIds.has(descriptor.id)) continue;
            seen.add(descriptor.id);
            descriptors.push(descriptor);
        }
    }
    return descriptors;
}

export function activeQuickActions(layers: CoachContextLayer[]): CoachQuickAction[] {
    return orderedContextLayers(layers)[0]?.quickActions ?? [];
}
