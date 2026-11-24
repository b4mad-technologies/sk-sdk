import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb, SpellkaveSession } from "../connection";
import { snapshotFromDb } from "../connection";

export type ActorClientSource = SpellkaveSession | DbConnection | SnapshotDb;
export type RMoveFn = DbConnection["reducers"]["rMove"];
export type RManipulateFn = DbConnection["reducers"]["rManipulate"];
export type RSessionCloseFn = DbConnection["reducers"]["rSessionClose"];
export type RSessionMoveFn = DbConnection["reducers"]["rSessionMove"];
export type RSessionOpenFn = DbConnection["reducers"]["rSessionOpen"];
export type RSenseFn = DbConnection["reducers"]["rSense"];
export type RInscribeTraceFn = DbConnection["reducers"]["rInscribeTrace"];
export type RReactFn = DbConnection["reducers"]["rReact"];
export type RReleaseClaimFn = DbConnection["reducers"]["rReleaseClaim"];
export type RActorWakeUpFn = DbConnection["reducers"]["rActorWakeUp"];
export type RAdvanceTurnFn = DbConnection["reducers"]["rAdvanceTurn"];

export interface ActorClientReducers {
	rMove?: RMoveFn;
	rManipulate?: RManipulateFn;
	rSessionClose?: RSessionCloseFn;
	rSessionMove?: RSessionMoveFn;
	rSessionOpen?: RSessionOpenFn;
	rSense?: RSenseFn;
	rInscribeTrace?: RInscribeTraceFn;
	rReact?: RReactFn;
	rReleaseClaim?: RReleaseClaimFn;
	rActorWakeUp?: RActorWakeUpFn;
	rAdvanceTurn?: RAdvanceTurnFn;
}

export function toConnDb(source: ActorClientSource): {
	db: SnapshotDb;
	reducers?: ActorClientReducers;
} {
	const conn = ("conn" in source ? source.conn : source) as Record<string, unknown>;
	if (typeof conn !== "object" || conn === null)
		throw new Error("actor client source is not an object");
	if ("db" in conn && conn.db && typeof conn.db === "object") {
		return {
			db: conn.db as SnapshotDb,
			reducers: (conn as { reducers?: ActorClientReducers }).reducers,
		};
	}
	return { db: conn as SnapshotDb, reducers: undefined };
}

export function actorReaders(db: SnapshotDb) {
	const s = snapshotFromDb(db);
	return {
		actors: { locations: () => Array.from(s.actors.locations()) },
		movement: {
			edges: () => Array.from(s.movement.edges()),
			nodes: () => Array.from(s.movement.nodes()),
		},
	};
}
