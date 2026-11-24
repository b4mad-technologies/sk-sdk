/** Scene snapshots and applies stay on the selected caller's connection. */
import type { SpellkaveSession } from "@spellkave/sdk";
import type { SceneSourceSnapshot, ScenesPort } from "@spellkave/tool-authoring";
export function createLiveScenesPort(deps: {
	session(): SpellkaveSession;
	endpoint(): string;
	apply(toml: string): Promise<{ ok: boolean; detail?: string }>;
}): ScenesPort {
	return {
		async snapshot(blueprintId) {
			const session = deps.session();
			const endpoint = deps.endpoint();
			if (!session.authenticatedIdentity || !session.conn.isActive)
				throw new Error("scene source unavailable; reconnect as the caller");
			return new Promise<SceneSourceSnapshot>((resolve, reject) => {
				let settled = false;
				// Snapshot completion must not wait for an unsubscribe acknowledgement.
				// The parent SDK owns disconnect callbacks; observe its active state here.
				const watch = setInterval(() => {
					try {
						if (!current()) fail(new Error("scene caller connection changed or disconnected"));
					} catch (error) {
						fail(error);
					}
				}, 40);
				function current() {
					return (
						session.conn.isActive &&
						deps.session().conn === session.conn &&
						deps.endpoint() === endpoint
					);
				}
				function fail(error: unknown) {
					if (settled) return;
					settled = true;
					clearInterval(watch);
					reject(error);
					try {
						if (handle.isActive()) handle.unsubscribe();
					} catch {
						/* Transport already ended. */
					}
				}
				const handle = session.conn
					.subscriptionBuilder()
					.onError(() => fail(new Error("scene source protocol unavailable or incomplete")))
					.onApplied(() => {
						if (settled) return;
						try {
							if (!current()) throw new Error("scene caller connection changed or disconnected");
							const rows = [...session.conn.db.scene_source.iter()].filter(
								(row) => row.graphId === blueprintId,
							);
							if (
								rows.length !== 1 ||
								rows[0]?.protocolVersion !== 1 ||
								rows[0]?.status !== "complete-empty"
							)
								throw new Error("scene source unavailable or incomplete");
							const row = rows[0];
							const snapshot: SceneSourceSnapshot = {
								protocol_version: 1,
								caller: session.authenticatedIdentity!.toHexString(),
								endpoint,
								world_instance_id: row.worldInstanceId,
								source_digest: row.sourceDigest,
								snapshot_json: row.snapshotJson,
							};
							settled = true;
							clearInterval(watch);
							resolve(snapshot);
							handle.unsubscribe();
						} catch (error) {
							fail(error);
						}
					})
					.subscribe((tables) =>
						tables.sceneSource!.where((row) => row.graphId!.eq(blueprintId)).build(),
					);
			});
		},
		apply: deps.apply,
	};
}
