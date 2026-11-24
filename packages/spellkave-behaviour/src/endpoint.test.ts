import { createServer } from "node:net";
import { afterEach, expect, it } from "vitest";
import {
	type EndpointProcess,
	startEndpointProcess,
	startUnreachableEndpoint,
} from "./endpoint.ts";

const endpoints: EndpointProcess[] = [];
afterEach(async () => {
	await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.stop()));
});

function contender(port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "unknown"));
		server.listen(port, "127.0.0.1", () =>
			server.close(() => reject(new Error("port was released"))),
		);
	});
}

// keep(K2): real OS socket ownership and child lifetime cannot be proved by HTTP response assertions.
it("holds independent reset endpoints until stop, with transport failures instead of HTTP answers", async () => {
	const started = await Promise.all(
		Array.from({ length: 8 }, async () => {
			const endpoint = await startUnreachableEndpoint();
			endpoints.push(endpoint);
			return endpoint;
		}),
	);
	expect(new Set(started.map((endpoint) => endpoint.port)).size).toBe(started.length);
	for (const endpoint of started) {
		expect(endpoint.port).toBeGreaterThan(0);
		expect(await contender(endpoint.port)).toBe("EADDRINUSE");
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(fetch(endpoint.url, { method: "POST", body: "probe" })).rejects.toThrow();
		}
		expect(await contender(endpoint.port)).toBe("EADDRINUSE");
	}
	await Promise.all(started.map((endpoint) => endpoint.stop()));
	await Promise.all(started.map((endpoint) => endpoint.stop()));
});

// keep(K2): fail a real child before readiness and preserve its diagnostics for the test author.
it("rejects an early exit with the child's log and exit status", async () => {
	await expect(
		startEndpointProcess({
			command: process.execPath,
			args: ["--eval", 'console.error("startup failed"); process.exitCode = 7'],
			ready: /^ready:(\d+)\n/m,
			readyWithinMs: 30_000,
		}),
	).rejects.toThrow(/exited 7 before readiness:\nstartup failed/);
});

// keep(K2): a missing executable must reject and clean up rather than leave a hanging startup promise.
it("rejects a spawn failure", async () => {
	await expect(
		startEndpointProcess({
			command: "/spellkave-test-no-such-command",
			args: [],
			ready: /^ready:(\d+)\n/m,
			readyWithinMs: 30_000,
		}),
	).rejects.toThrow(/ENOENT/);
});

// keep(K2): startup timeout must kill a listener that has not announced readiness.
it("stops a child that never reports readiness", async () => {
	await expect(
		startEndpointProcess({
			command: process.execPath,
			args: ["--eval", "setInterval(() => {}, 1000)"],
			ready: /^ready:(\d+)\n/m,
			readyWithinMs: 100,
		}),
	).rejects.toThrow(/not ready within 100 ms/);
});
