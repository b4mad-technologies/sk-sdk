/** Full-text recorder for the bounded .32 local probes; authentication is never recorded. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actorIdForBody, entityIdByManifestKey, type TestWorld, waitForEvent } from "./live";

export const proofText = (value: unknown) =>
	JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)) ?? "";

export function namespaceProof(sourcePath: string, phase: string) {
	const source = readFileSync(sourcePath);
	const sourceSha256 = createHash("sha256").update(source).digest("hex");
	const output = path.resolve(
		process.env.SPELLKAVE_NAMESPACE_CONTROL_EVIDENCE_DIR ??
			path.join(import.meta.dirname, "../../../.local/namespace-control-evidence", phase),
	);
	mkdirSync(output, { recursive: true });
	writeFileSync(path.join(output, "test-source.ts"), source);
	const recorderSource = readFileSync(import.meta.filename);
	writeFileSync(path.join(output, "recorder-source.ts"), recorderSource);
	const recorderSourceSha256 = createHash("sha256").update(recorderSource).digest("hex");
	const calls: {
		id: number;
		kind: string;
		operation: string;
		requestText: string;
		responseText: string;
		requestBytes: number;
		responseBytes: number;
		outcome: string;
	}[] = [];
	const observations: unknown[] = [];
	const identities: Record<string, string> = {};
	let publisherIdentity = "";
	const started = Date.now();
	const persist = () =>
		writeFileSync(
			path.join(output, "local-live.json"),
			JSON.stringify(
				{
					schema: "authority-fence-text-capture/v2",
					testedAt: new Date().toISOString(),
					baseRevision: "e2751c4b63f1a67ccf89edd3f672678cdfc322b5",
					testSourceSha256: sourceSha256,
					recorderSourceSha256,
					surface: "local SDK and publisher SQL probes; not a hosted consumer",
					stage: phase,
					calls,
					observations,
					migration: { publisherIdentity, identities },
					captureBoundary: {
						exclusions: [
							"authentication/token minting",
							"connection bootstrap before recorder",
							"subscription snapshots",
							"binary publication",
							"world save",
							"coding-agent development",
						],
					},
					cost: {
						calls: calls.length,
						requestBytes: calls.reduce((sum, call) => sum + call.requestBytes, 0),
						responseBytes: calls.reduce((sum, call) => sum + call.responseBytes, 0),
						elapsedMs: Date.now() - started,
					},
					modelAccounting: { inferenceCalls: 0, agentContext: "N/A deterministic scripted probe" },
					imageAccounting: { images: 0 },
				},
				(_, item) => (typeof item === "bigint" ? item.toString() : item),
				2,
			) + "\n",
		);
	async function dispatch<T>(
		kind: string,
		operation: string,
		requestText: string,
		invoke: () => Promise<T>,
	): Promise<T> {
		const call = {
			id: calls.length + 1,
			kind,
			operation,
			requestText,
			responseText: "",
			requestBytes: Buffer.byteLength(requestText),
			responseBytes: 0,
			outcome: "pending",
		};
		calls.push(call);
		persist();
		try {
			const result = await invoke();
			call.responseText = typeof result === "string" ? result : proofText(result);
			call.outcome = "ok";
			return result;
		} catch (error) {
			call.responseText = String(error);
			call.outcome = String(error);
			throw error;
		} finally {
			call.responseBytes = Buffer.byteLength(call.responseText);
			persist();
		}
	}
	function track(world: TestWorld, label: string) {
		if (label === "publisher") publisherIdentity = world.identity ?? "";
		else identities[label] = world.identity ?? "";
		const reducers = world.conn.reducers;
		Reflect.set(
			world.conn,
			"reducers",
			new Proxy(reducers, {
				get(target, key, receiver) {
					const method = Reflect.get(target, key, receiver);
					return typeof method === "function"
						? (...args: unknown[]) =>
								dispatch(
									"SDK reducer dispatch",
									String(key),
									proofText({ method: String(key), args }),
									async () => Reflect.apply(method, target, args),
								)
						: method;
				},
			}),
		);
		persist();
		return world;
	}
	async function sql(world: TestWorld, query: string): Promise<Record<string, unknown>[]> {
		if (!world.token || !query.startsWith("SELECT "))
			throw new Error("namespace proof requires explicit publisher token and SELECT");
		const endpoint = `${process.env.SPELLKAVE_URL}/v1/database/${process.env.SPELLKAVE_DB ?? "spellkave-dev"}/sql`;
		const raw = await dispatch("publisher SQL observation", "SELECT", query, async () => {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "text/plain", Authorization: `Bearer ${world.token}` },
				body: query,
			});
			const body = await response.text();
			if (!response.ok) throw new Error(`SQL ${response.status}: ${body}`);
			return body;
		});
		const statements = JSON.parse(raw) as {
			schema: { elements: { name: { some?: string } }[] };
			rows: unknown[][];
		}[];
		return statements.flatMap((statement) =>
			statement.rows.map((row) =>
				Object.fromEntries(
					statement.schema.elements.map((column, index) => [
						column.name.some ?? `column${index}`,
						row[index],
					]),
				),
			),
		);
	}
	persist();
	return {
		track,
		sql,
		observe(value: unknown) {
			observations.push(value);
			persist();
		},
		persist,
		output,
	};
}

/** Resolve the namespace fixture on the same owner cache the probe asserts on. */
export async function receiveNamespaceActor(world: TestWorld, manifestKey: string) {
	// Admission and fixture visibility are separate observations. The historical
	// module has no debug_sync_marker; use the owner subscription's own events.
	await waitForEvent(
		world,
		() => {
			const body = entityIdByManifestKey(world.db(), manifestKey);
			return body !== null && actorIdForBody(world.db(), body) !== null;
		},
		`namespace fixture body and actor were not delivered: ${manifestKey}`,
	);
	const body = entityIdByManifestKey(world.db(), manifestKey);
	return { body, actor: body === null ? null : actorIdForBody(world.db(), body) };
}
