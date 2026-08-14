import {
    createOfflineTrainerDataSource,
    type TrainerDataSource,
} from "$lib/trainer-data-source";
import type { OfflineRepository } from "./repository";
import type { OfflinePackageManifestV1 } from "./types";

export type OfflinePracticeBinding = {
    manifest: OfflinePackageManifestV1;
    source: TrainerDataSource;
};

/**
 * Resolve the explicit route selector to one ready, account-bound package.
 * Connectivity is deliberately absent from this decision: once returned, the
 * mounted trainer can only speak to this local source.
 */
export async function bindOfflinePracticePackage(
    repository: OfflineRepository,
    packageId: string,
    expectedUserId: string | null = null,
): Promise<OfflinePracticeBinding> {
    const marker = await repository.getAccountMarker();
    if (!marker) {
        throw new Error("No offline account is open on this device.");
    }
    if (expectedUserId && expectedUserId !== marker.userId) {
        throw new Error("This download belongs to a different account.");
    }

    const manifest = (await repository.listPackages(marker.userId)).find(
        (candidate) => candidate.packageId === packageId,
    );
    if (!manifest) {
        throw new Error("This downloaded package is not ready on this device.");
    }

    const session = await repository.loadSession(manifest.userId, manifest.sessionId);
    if (!session) {
        throw new Error("The downloaded practice session is unavailable.");
    }
    const settings = session.row.settings as Record<string, unknown>;
    if (settings.mode !== "new" || settings.format !== "practice") {
        throw new Error("This download is not a New-mode practice session.");
    }

    return {
        manifest,
        source: createOfflineTrainerDataSource({ repository, manifest }),
    };
}
