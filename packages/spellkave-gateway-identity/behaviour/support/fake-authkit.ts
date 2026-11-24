// A fake AuthKit token endpoint for behaviour scenarios: an HTTPS server on an
// ephemeral 127.0.0.1 port that records every request and answers with what
// the scenario set. A tool under test never reaches the real AuthKit.
//
// Why HTTPS: the machine-user refresh grant (ADR-0124 D-7) refuses any issuer
// that is not an `https://` AuthKit domain, and it derives the token endpoint
// from the issuer. So the fake gets a self-signed certificate (made once per
// process with `openssl`), and the child process trusts it through
// `NODE_EXTRA_CA_CERTS`, a standard Node variable. The tool needs no test-only
// URL override and runs exactly as in production.
//
// Answers follow the OAuth 2.0 token-endpoint shapes (RFC 6749 §5.1 success,
// §5.2 error), which AuthKit's `/oauth2/token` uses. Nothing here imports the
// package's `src/`, so other suites (a gateway, a CLI) can reuse it as is.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One request the fake received, as the tool sent it. */
export interface FakeAuthKitRequest {
	readonly method: string;
	readonly path: string;
	/** The raw body, for "never contains" checks. */
	readonly body: string;
	/** The body parsed as an `application/x-www-form-urlencoded` form. */
	readonly form: URLSearchParams;
}

export interface FakeAuthKitAnswer {
	readonly status: number;
	readonly body: unknown;
}

export interface FakeAuthKit {
	/** `https://127.0.0.1:<port>`, no trailing slash: what a seed's `issuer` names. */
	readonly issuer: string;
	/** PEM file a child process trusts via `NODE_EXTRA_CA_CERTS`. */
	readonly caFile: string;
	readonly requests: readonly FakeAuthKitRequest[];
	/** What every following request gets; until set, HTTP 500 `no_answer_configured`. */
	answer(answer: FakeAuthKitAnswer): void;
	/** Stops listening: later requests are refused, as when AuthKit is down. */
	close(): Promise<void>;
}

let tls: { key: Buffer; cert: Buffer; caFile: string } | undefined;

/** One self-signed certificate for 127.0.0.1 per process, removed on exit. */
function selfSignedCertificate(): { key: Buffer; cert: Buffer; caFile: string } {
	if (tls) return tls;
	const dir = mkdtempSync(join(tmpdir(), "fake-authkit-tls-"));
	process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
	const keyFile = join(dir, "key.pem");
	const caFile = join(dir, "cert.pem");
	const openssl = (args: string[]) => {
		try {
			execFileSync("openssl", args, { stdio: "ignore" });
		} catch (error) {
			throw new Error(
				`fake AuthKit needs the openssl CLI for its TLS certificate: ${String(error)}`,
			);
		}
	};
	openssl([
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		keyFile,
		"-out",
		caFile,
		"-days",
		"1",
		"-subj",
		"/CN=127.0.0.1",
		"-addext",
		"subjectAltName=IP:127.0.0.1",
	]);
	tls = { key: readFileSync(keyFile), cert: readFileSync(caFile), caFile };
	return tls;
}

export async function startFakeAuthKit(): Promise<FakeAuthKit> {
	const { key, cert, caFile } = selfSignedCertificate();
	const requests: FakeAuthKitRequest[] = [];
	let current: FakeAuthKitAnswer = { status: 500, body: { error: "no_answer_configured" } };
	const server: Server = createServer({ key, cert }, (req, res) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => {
			body += chunk;
		});
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				path: req.url ?? "",
				body,
				form: new URLSearchParams(body),
			});
			res.writeHead(current.status, { "content-type": "application/json" });
			res.end(JSON.stringify(current.body));
		});
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("fake AuthKit is not on a TCP port");
	const { port } = address;
	let closed = false;
	return {
		issuer: `https://127.0.0.1:${port}`,
		caFile,
		requests,
		answer(answer) {
			current = answer;
		},
		close() {
			if (closed) return Promise.resolve();
			closed = true;
			server.closeAllConnections();
			return new Promise((done) => server.close(() => done()));
		},
	};
}

/**
 * An access token with the claims a tool reads. It is not signed: the
 * refresh grant only decodes `iss`/`sub`; signature checks belong to the
 * gateways that verify against the JWKS.
 */
export function unsignedJwt(claims: Record<string, unknown>): string {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.unsigned`;
}
