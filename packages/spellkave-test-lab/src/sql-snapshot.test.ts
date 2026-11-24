// Admission rollback snapshots read every selected table once and still expose a private-row write.
// Injected readers and a loopback HTTP peer prove the protocol without a database or CLI process.
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { rows } from "./environment-ownership-fixture";
import type { TestWorld } from "./live";
import { publisherSqlReader, sqlSnapshot } from "./sql-snapshot";

// ci-allow-start(raw-sql): offline rollback-snapshot fixtures assert complete SQL text through an injected reader.
const tables = ["public_rows", "private_rows", "empty_rows"];
function reader(privateValue = "9007199254740993") {
	return vi.fn(async (sql: string) => {
		// Real server rejection observed in CI run 39503498459.
		if (sql.includes(";")) throw new Error("Multiple SQL statements are not supported");
		return sql
			.split(";")
			.map((statement) => {
				switch (statement.trim()) {
					case "SELECT * FROM public_rows":
						return "id\n18446744073709551615\n9007199254740993\n";
					case "SELECT * FROM private_rows":
						return `secret\n${privateValue}\n`;
					case "SELECT * FROM empty_rows":
						return "empty\n";
					default:
						throw new Error(`unexpected SQL ${statement}`);
				}
			})
			.join("");
	});
}

// keep(K2): count the injected publisher SQL calls while retaining the full returned text.
it("reads each table in a supported single statement and preserves integers, empty tables and row order", async () => {
	const query = reader();
	const snapshot = await sqlSnapshot(tables, query);
	expect(query.mock.calls.map(([sql]) => sql)).toEqual([
		"SELECT * FROM public_rows",
		"SELECT * FROM private_rows",
		"SELECT * FROM empty_rows",
	]);
	expect(snapshot).toEqual({
		public_rows: "id\n18446744073709551615\n9007199254740993\n",
		private_rows: "secret\n9007199254740993\n",
		empty_rows: "empty\n",
	});
});

// keep(K2): inject a private write below the SQL observation boundary and exercise the rollback comparison.
it("detects a private-row write differing only in an integer beyond JavaScript's exact range", async () => {
	const before = await sqlSnapshot(tables, reader());
	const after = await sqlSnapshot(tables, reader("9007199254740992"));
	expect(() => expect(after).toEqual(before)).toThrow();
});

// keep(K2): publisher authorization failures must fail the snapshot, never look like empty tables.
it("propagates a failed read", async () => {
	await expect(
		sqlSnapshot(tables, async () => {
			throw new Error("publisher refused");
		}),
	).rejects.toThrow("publisher refused");
});
// keep(K2): a real loopback HTTP peer reproduces the server's one-statement boundary and publisher visibility.
it("reads authenticated single-statement HTTP results losslessly and ignores only execution timing", async () => {
	let privateValue = "9007199254740993";
	let duration = 0;
	let status = 200;
	let malformed = false;
	const calls: string[] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		calls.push(body);
		if (request.headers.authorization !== "Bearer synthetic-owner") {
			response.writeHead(403).end("private table");
			return;
		}
		if (body.includes(";")) {
			response.writeHead(400).end("Multiple SQL statements are not supported");
			return;
		}
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(
			malformed
				? "[{}]"
				: `[{"schema":{"elements":[]},"rows":${body.endsWith("empty_rows") ? "[]" : `[[18446744073709551615,340282366920938463463374607431768211455,${privateValue}],[2]]`},"total_duration_micros":${++duration}}]`,
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing loopback address");
	const url = `http://127.0.0.1:${address.port}`;
	try {
		const query = publisherSqlReader(url, "proof", "synthetic-owner");
		const before = await sqlSnapshot(["private_rows", "empty_rows"], query);
		expect(await sqlSnapshot(["private_rows", "empty_rows"], query)).toEqual(before);
		expect(before.private_rows).toContain("340282366920938463463374607431768211455");
		expect(before.private_rows).toContain("9007199254740993],[2]");
		expect(before.empty_rows).toContain('"rows":[]');
		privateValue = "9007199254740992";
		expect(await sqlSnapshot(["private_rows", "empty_rows"], query)).not.toEqual(before);
		expect(calls).toEqual(
			Array(3).fill(["SELECT * FROM private_rows", "SELECT * FROM empty_rows"]).flat(),
		);
		await expect(
			publisherSqlReader(url, "proof", "wrong")("SELECT * FROM private_rows"),
		).rejects.toThrow("403");
		status = 500;
		await expect(query("SELECT * FROM private_rows")).rejects.toThrow("500");
		status = 200;
		malformed = true;
		await expect(query("SELECT * FROM private_rows")).rejects.toThrow(
			"publisher SQL snapshot failed",
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

// Authored-session snapshots share the complete publisher SQL observation boundary.
const publisher = { token: "synthetic-owner" } as TestWorld;
const authoredTables = [
	"session",
	"session_participant",
	"entity_location",
	"actor_spatial_location",
	"place_graph_definition",
	"turn_state",
	"event_session_open",
	"event_turn_start",
	"event_turn_end",
	"trace",
	"autonomy_job",
	"object_state",
	"target_condition",
	"condition_boundary_expiry",
	"event_condition_delta",
	"event_boundary_fired",
	"event_channel_window_refresh",
	"event_action_recharge_fired",
];

// keep(K2): pending readers prove the authored snapshot concurrency bound and ordered complete rows.
