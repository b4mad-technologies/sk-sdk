import { describe, expect, it } from "vitest";

import { parseAppConfig, parsePersonaProfile, validatePersonaContract } from "../core/profile";

const FULL_PROFILE = `
[connection]
url = "http://127.0.0.1:3000"
db = "spellkave-dev"
env = "local"

[identity]
role = "watcher"
in_world_self = "scout-01"
credential = { kind = "env_var", name = "SPELLKAVE_TOKEN" }

[defaults]
mode = "passive"
`;

describe("parseAppConfig", () => {
	it("accepts an empty file", () => {
		expect(parseAppConfig("")).toEqual({});
	});

	it("parses default_profile", () => {
		expect(parseAppConfig(`default_profile = "scout"`)).toEqual({
			default_profile: "scout",
		});
	});

	it("rejects unknown fields", () => {
		expect(() => parseAppConfig(`wat = 1`)).toThrow(/unknown field/);
	});

	it("rejects non-string default_profile", () => {
		expect(() => parseAppConfig(`default_profile = 42`)).toThrow();
	});
});

describe("parsePersonaProfile", () => {
	it("round-trips a full profile", () => {
		const p = parsePersonaProfile(FULL_PROFILE);
		expect(p.connection.url).toBe("http://127.0.0.1:3000");
		expect(p.connection.db).toBe("spellkave-dev");
		expect(p.connection.env).toBe("local");
		expect(p.identity.role).toBe("watcher");
		expect(p.identity.in_world_self).toBe("scout-01");
		expect(p.identity.credential).toEqual({
			kind: "env_var",
			name: "SPELLKAVE_TOKEN",
		});
		expect(p.defaults.mode).toBe("passive");
	});

	it("requires [connection]", () => {
		expect(() =>
			parsePersonaProfile(`
[identity]
role = "x"
in_world_self = "y"
`),
		).toThrow(/connection/);
	});

	it("requires [identity]", () => {
		expect(() =>
			parsePersonaProfile(`
[connection]
url = "u"
db = "d"
`),
		).toThrow(/identity/);
	});

	it("rejects unknown top-level tables", () => {
		expect(() =>
			parsePersonaProfile(`
[connection]
url = "u"
db = "d"

[identity]
role = "r"
in_world_self = "x"

[wat]
key = "value"
`),
		).toThrow(/unknown table/);
	});

	it("rejects unknown fields inside [connection]", () => {
		expect(() =>
			parsePersonaProfile(`
[connection]
url = "u"
db = "d"
extra = "bad"

[identity]
role = "r"
in_world_self = "x"
`),
		).toThrow(/unknown field in \[connection\]/);
	});

	it("supports file credential variant", () => {
		const p = parsePersonaProfile(`
[connection]
url = "u"
db = "d"

[identity]
role = "r"
in_world_self = "x"
credential = { kind = "file", path = "/etc/cred" }
`);
		expect(p.identity.credential).toEqual({
			kind: "file",
			path: "/etc/cred",
		});
	});

	it("supports inline credential variant", () => {
		const p = parsePersonaProfile(`
[connection]
url = "u"
db = "d"

[identity]
role = "r"
in_world_self = "x"
credential = { kind = "inline", value = "abc" }
`);
		expect(p.identity.credential).toEqual({
			kind: "inline",
			value: "abc",
		});
	});

	it("rejects unknown credential kinds", () => {
		expect(() =>
			parsePersonaProfile(`
[connection]
url = "u"
db = "d"

[identity]
role = "r"
in_world_self = "x"
credential = { kind = "keychain", handle = "h" }
`),
		).toThrow(/not one of/);
	});

	it("rejects credential variant with extra fields", () => {
		expect(() =>
			parsePersonaProfile(`
[connection]
url = "u"
db = "d"

[identity]
role = "r"
in_world_self = "x"
credential = { kind = "env_var", name = "TOK", extra = "bad" }
`),
		).toThrow(/unknown field in identity\.credential/);
	});

	it("makes credential optional (cloud preset shape)", () => {
		const p = parsePersonaProfile(`
[connection]
url = "https://maincloud.spacetimedb.com"
db = "spellkave-dev"

[identity]
role = "watcher"
in_world_self = "scout-01"
`);
		expect(p.identity.credential).toBeUndefined();
	});
});

describe("validatePersonaContract", () => {
	it("rejects empty url", () => {
		expect(() =>
			validatePersonaContract({
				connection: { url: " ", db: "d" },
				identity: { role: "r", in_world_self: "x" },
				defaults: {},
			}),
		).toThrow(/connection.url/);
	});

	it("rejects empty in_world_self", () => {
		expect(() =>
			validatePersonaContract({
				connection: { url: "u", db: "d" },
				identity: { role: "r", in_world_self: "  " },
				defaults: {},
			}),
		).toThrow(/in_world_self/);
	});

	it("accepts a minimal valid profile", () => {
		expect(() =>
			validatePersonaContract({
				connection: { url: "u", db: "d" },
				identity: { role: "r", in_world_self: "x" },
				defaults: {},
			}),
		).not.toThrow();
	});
});
