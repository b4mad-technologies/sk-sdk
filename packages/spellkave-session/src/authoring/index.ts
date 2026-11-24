/** Live SDK composition for canonical AUTHOR execution. */
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	createLiveAuthorTarget as createSessionLiveAuthorTarget,
	type LiveAuthorTargetDeps,
} from "./live-author-target.ts";

export * from "@spellkave/tool-authoring";

export interface SessionLiveAuthorTargetDeps extends Omit<LiveAuthorTargetDeps, "db"> {
	db: SnapshotDb | (() => SnapshotDb | undefined) | undefined;
}

export function createLiveAuthorTarget(deps: SessionLiveAuthorTargetDeps) {
	return createSessionLiveAuthorTarget(deps);
}

export { createCallerSessionTools } from "./caller-tools";
export {
	type ApplysetPortSession,
	createLiveApplysetPort,
} from "./live-applyset-port.ts";
export type { LiveAuthorTargetDeps } from "./live-author-target.ts";
export { createLiveCanIPort, mapProcedureResult } from "./live-can-i-port";
export { createLiveExplorationPort } from "./live-exploration-port";
export { createLiveGrantsPort } from "./live-grants-port";
export { createLiveScenesPort } from "./live-scenes-port";
export { createLiveScopedSnapshotPort } from "./live-scoped-instance-port";
