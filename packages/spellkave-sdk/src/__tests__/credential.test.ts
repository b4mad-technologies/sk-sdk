import { describe, expect, it } from "vitest";

import {
	type CredentialRef,
	decodeRustSdkCredentialToken,
	resolveCredential,
	resolveSpacetimeClientCredentialToken,
	resolveSpacetimeConfigPathToken,
	resolveSpacetimeLoginToken,
	spacetimeClientCredentialKey,
	validateCredentialRef,
} from "../core/credential";

describe("validateCredentialRef", () => {
	it("flags empty env var name", () => {
		expect(validateCredentialRef({ kind: "env_var", name: "" })).toEqual({
			kind: "empty",
		});
	});

	it("flags empty inline value", () => {
		expect(validateCredentialRef({ kind: "inline", value: "" })).toEqual({
			kind: "empty",
		});
	});

	it("accepts well-formed refs", () => {
		expect(validateCredentialRef({ kind: "env_var", name: "TOKEN" })).toEqual({ kind: "ok" });
		expect(validateCredentialRef({ kind: "inline", value: "abc" })).toEqual({ kind: "ok" });
		expect(validateCredentialRef({ kind: "file", path: "/etc/cred" })).toEqual({ kind: "ok" });
	});
});

describe("resolveCredential — env_var", () => {
	it("returns the value when env var is non-empty", () => {
		expect(resolveCredential({ kind: "env_var", name: "FOO" }, { env: { FOO: "secret" } })).toBe(
			"secret",
		);
	});

	it("fails closed when env var is missing", () => {
		expect(() => resolveCredential({ kind: "env_var", name: "MISSING" }, { env: {} })).toThrow(
			/missing or empty/,
		);
	});

	it("fails closed when env var is empty string", () => {
		expect(() =>
			resolveCredential({ kind: "env_var", name: "EMPTY" }, { env: { EMPTY: "" } }),
		).toThrow(/missing or empty/);
	});

	it("fails closed when ref name itself is empty", () => {
		expect(() => resolveCredential({ kind: "env_var", name: "" }, { env: {} })).toThrow(/empty/);
	});
});

describe("resolveCredential — file", () => {
	it("returns the trimmed first line when readable", () => {
		expect(
			resolveCredential({ kind: "file", path: "/x" }, { readFile: () => "line-one\nline-two\n" }),
		).toBe("line-one");
	});

	it("fails closed when file is unreadable", () => {
		expect(() =>
			resolveCredential(
				{ kind: "file", path: "/x" },
				{
					readFile: () => {
						throw new Error("ENOENT");
					},
				},
			),
		).toThrow(/unreadable/);
	});

	it("fails closed on empty file", () => {
		expect(() =>
			resolveCredential({ kind: "file", path: "/x" }, { readFile: () => "   \n" }),
		).toThrow(/empty/);
	});
});

describe("resolveCredential — inline", () => {
	it("returns the literal value", () => {
		expect(resolveCredential({ kind: "inline", value: "hunter2" })).toBe("hunter2");
	});

	it("rejects empty inline", () => {
		const ref: CredentialRef = { kind: "inline", value: "" };
		expect(() => resolveCredential(ref)).toThrow(/empty/);
	});
});

describe("resolveSpacetimeLoginToken (cloud preset fallback)", () => {
	it("returns the token when reader produces one", () => {
		expect(resolveSpacetimeLoginToken({ readSpacetimeToken: () => "tok-abc" })).toBe("tok-abc");
	});

	it("fails closed when no token is found", () => {
		expect(() => resolveSpacetimeLoginToken({ readSpacetimeToken: () => undefined })).toThrow(
			/no `spacetime login` token/,
		);
	});

	it("fails closed when token is empty", () => {
		expect(() => resolveSpacetimeLoginToken({ readSpacetimeToken: () => "" })).toThrow(
			/no `spacetime login` token/,
		);
	});

	it("default reader extracts spacetimedb_token from cli.toml", () => {
		const readFile = (path: string): string => {
			if (path.endsWith("/.config/spacetime/cli.toml")) {
				return [
					'default_server = "maincloud"',
					'spacetimedb_token = "tok-from-cli-toml"',
					"",
					"[[server_configs]]",
					'nickname = "maincloud"',
				].join("\n");
			}
			throw new Error("ENOENT");
		};
		expect(resolveSpacetimeLoginToken({ home: "/home/u", readFile })).toBe("tok-from-cli-toml");
	});

	it("default reader falls back to legacy bare token file", () => {
		const readFile = (path: string): string => {
			if (path.endsWith("/.config/spacetime/token")) return "legacy-tok\n";
			throw new Error("ENOENT");
		};
		expect(resolveSpacetimeLoginToken({ home: "/home/u", readFile })).toBe("legacy-tok");
	});

	it("default reader throws when nothing readable", () => {
		const readFile = (_p: string): string => {
			throw new Error("ENOENT");
		};
		expect(() => resolveSpacetimeLoginToken({ home: "/home/u", readFile })).toThrow(
			/no `spacetime login` token/,
		);
	});

	it("default reader skips cli.toml without spacetimedb_token, tries legacy", () => {
		const readFile = (path: string): string => {
			if (path.endsWith("/.config/spacetime/cli.toml")) {
				return 'default_server = "maincloud"\n';
			}
			if (path.endsWith("/.config/spacetime/token")) return "fallback-tok";
			throw new Error("ENOENT");
		};
		expect(resolveSpacetimeLoginToken({ home: "/home/u", readFile })).toBe("fallback-tok");
	});
});

describe("resolveSpacetimeConfigPathToken", () => {
	it("returns undefined when SPACETIME_CONFIG_PATH is not set", () => {
		expect(resolveSpacetimeConfigPathToken({ env: {} })).toBeUndefined();
	});

	it("extracts spacetimedb_token from the configured cli.toml", () => {
		expect(
			resolveSpacetimeConfigPathToken({
				env: { SPACETIME_CONFIG_PATH: "/worktree/cli.toml" },
				readFile: (path) => {
					expect(path).toBe("/worktree/cli.toml");
					return 'spacetimedb_token = "worktree-token"\n';
				},
			}),
		).toBe("worktree-token");
	});

	it("returns undefined for unreadable config", () => {
		expect(
			resolveSpacetimeConfigPathToken({
				env: { SPACETIME_CONFIG_PATH: "/missing/cli.toml" },
				readFile: () => {
					throw new Error("ENOENT");
				},
			}),
		).toBeUndefined();
	});
});

describe("resolveSpacetimeClientCredentialToken", () => {
	it("matches the Rust client credential key sanitizer", () => {
		expect(spacetimeClientCredentialKey("http://127.0.0.1:6395", "spellkave-dev")).toBe(
			"spellkave-http___127_0_0_1_6395-spellkave-dev",
		);
	});

	it("reads the token saved by the Rust client credential store", () => {
		const token = Buffer.from("seed-token", "utf8");
		const bytes = Buffer.alloc(4 + token.length);
		bytes.writeUInt32LE(token.length, 0);
		token.copy(bytes, 4);

		expect(
			resolveSpacetimeClientCredentialToken("http://127.0.0.1:6395", "spellkave-dev", {
				home: "/home/u",
				readFileBytes: (path) => {
					expect(path).toBe(
						"/home/u/.spacetimedb_client_credentials/spellkave-http___127_0_0_1_6395-spellkave-dev",
					);
					return bytes;
				},
			}),
		).toBe("seed-token");
	});

	it("decodes the Rust SDK single-field BSATN credential payload", () => {
		const token = Buffer.from("jwt-token", "utf8");
		const bytes = Buffer.alloc(4 + token.length);
		bytes.writeUInt32LE(token.length, 0);
		token.copy(bytes, 4);
		expect(decodeRustSdkCredentialToken(bytes)).toBe("jwt-token");
	});
});
