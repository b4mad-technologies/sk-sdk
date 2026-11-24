// Reader: ADR-0149 export result, read through the view over the caller's
// own rows. The retired `manifest_export` buffer is private and no longer written.
//
// The view is subscribed only when the module lists it
// (`OPTIONAL_SATELLITE_TABLES` in connection.ts). A module without the view
// has no export on this client.

import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

export const MANIFEST_EXPORT_VIEW = "visible_manifest_export_result";

// Declares the view. `buildSubscribeSet` drops it; `subscribeSetForSurface`
// adds it back only when the published module lists it.
export const requiredTables: RequiredTables<[typeof MANIFEST_EXPORT_VIEW]> = [MANIFEST_EXPORT_VIEW];
registerReaderManifest({ requiredTables });

export interface ManifestExportRow {
	bundleId: string;
	requestedAtTick: number;
	manifestJson: string;
	status: string;
	rowCount: number;
	diagnostics: string;
}

export class ManifestExportUnavailableError extends Error {
	constructor() {
		super("manifest export is not available");
		this.name = "ManifestExportUnavailableError";
	}
}

/** True when the published module lists the export view. */
export function manifestExportAvailable(tables: readonly string[]): boolean {
	return tables.includes(MANIFEST_EXPORT_VIEW);
}

/**
 * Refuse an export against a module that does not list the view. Callers
 * that already know the surface use this before `r_export_manifest`.
 */
export function assertManifestExportAvailable(tables: readonly string[]): void {
	if (!manifestExportAvailable(tables)) {
		throw new ManifestExportUnavailableError();
	}
}

/** Read the caller's export result for `bundleId` from the view, or `undefined`. */
export function readManifestExport(
	db: SnapshotDb,
	bundleId: string,
): ManifestExportRow | undefined {
	const row = rows<{
		bundleId?: unknown;
		bundle_id?: unknown;
		requestedAtTick?: unknown;
		requested_at_tick?: unknown;
		manifestJson?: unknown;
		manifest_json?: unknown;
		status?: unknown;
		rowCount?: unknown;
		row_count?: unknown;
		diagnostics?: unknown;
	}>(db, "visibleManifestExportResult", "visible_manifest_export_result").find(
		(candidate) => asString(candidate.bundleId ?? candidate.bundle_id) === bundleId,
	);
	if (row === undefined) return undefined;
	return {
		bundleId: asString(row.bundleId ?? row.bundle_id),
		requestedAtTick: asNumber(row.requestedAtTick ?? row.requested_at_tick),
		manifestJson: asString(row.manifestJson ?? row.manifest_json),
		status: asString(row.status),
		rowCount: asNumber(row.rowCount ?? row.row_count),
		diagnostics: asString(row.diagnostics),
	};
}
