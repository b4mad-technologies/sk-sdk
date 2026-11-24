// Publisher SQL snapshots retain every selected schema and row through single-statement reads.
export async function sqlSnapshot(
	tables: readonly string[],
	query: (sql: string) => Promise<string>,
): Promise<Record<string, string>> {
	const snapshots: Record<string, string> = {};
	// ci-allow(raw-sql): independent publisher HTTP SQL rollback snapshot, never a subscription; compare every selected row including private state.
	for (const table of tables) snapshots[table] = await query(`SELECT * FROM ${table}`);
	return snapshots;
}

export function publisherSqlReader(url: string, db: string, token: string) {
	if (!token) throw new Error("snapshot requires the isolated publisher credential");
	const endpoint = `${url.replace(/\/$/, "")}/v1/database/${db}/sql`;
	return async (sql: string): Promise<string> => {
		let status: number | undefined;
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
				body: sql,
				signal: AbortSignal.timeout(10_000),
			});
			status = response.status;
			if (!response.ok) throw new Error(`publisher SQL refused: HTTP ${response.status}`);
			// Node 24 reviver sources + rawJSON retain exact numeric literals, including u128/u256.
			const raw = JSON as typeof JSON & { rawJSON(source: string): unknown };
			const statements = JSON.parse(
				await response.text(),
				(_key: string, value: unknown, context?: { source: string }) => {
					if (typeof value !== "number") return value;
					if (!context) throw new Error("lossless SQL snapshot requires JSON reviver sources");
					return raw.rawJSON(context.source);
				},
			);
			if (
				!Array.isArray(statements) ||
				statements.length !== 1 ||
				!Array.isArray(statements[0]?.rows) ||
				!Array.isArray(statements[0]?.schema?.elements)
			)
				throw new Error("invalid single-statement SQL result");
			// Execution timing varies per request. Schema and every ordered row remain intact.
			return JSON.stringify({ schema: statements[0].schema, rows: statements[0].rows });
		} catch {
			// Never propagate response bodies or transport causes: either could echo a bearer token.
			throw new Error(
				status !== undefined && status !== 200
					? `publisher SQL refused: HTTP ${status}`
					: "publisher SQL snapshot failed",
			);
		}
	};
}
