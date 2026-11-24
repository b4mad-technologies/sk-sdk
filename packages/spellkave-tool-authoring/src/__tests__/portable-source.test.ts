import { describe, expect, it } from "vitest";
import { portableSourceFilesystem } from "../portable-source";

const source = {
	root_path: "world/manifest.toml",
	root_toml: "root",
	fragments: [{ path: "world/part.toml", toml: "part" }],
};

describe("invocation-local portable source", () => {
	it("resolves supplied includes and keeps separate invocations isolated", () => {
		const fs = portableSourceFilesystem(source);
		expect(fs.readText(fs.join(fs.dirname(source.root_path), "./part.toml"))).toBe("part");
		expect(() => fs.readText("world/missing.toml")).toThrow("missing supplied fragment");
		expect(() =>
			portableSourceFilesystem({ ...source, fragments: [] }).readText("world/part.toml"),
		).toThrow("missing supplied fragment");
		expect(() => fs.writeText("world/part.toml", "changed")).toThrow("read-only");
	});
	it.each([
		"../part.toml",
		"a/../part.toml",
		"/etc/passwd",
		"C:/part.toml",
		"https://host/file",
		"part\\file",
		"part\0file",
		"./../part.toml",
	])("refuses unsafe names and includes: %s", (path) => {
		expect(() => portableSourceFilesystem({ ...source, root_path: path })).toThrow(
			"invalid_source",
		);
		const fs = portableSourceFilesystem(source);
		expect(() => fs.join("world", path)).toThrow("invalid_source");
	});
	it("refuses duplicate normalized names including the root", () => {
		expect(() =>
			portableSourceFilesystem({
				...source,
				fragments: [{ path: "world/./manifest.toml", toml: "other" }],
			}),
		).toThrow("duplicate logical path");
	});
	it("bounds decoded UTF-8 bytes and fragment count before constructing the map", () => {
		expect(() => portableSourceFilesystem({ ...source, root_toml: "é".repeat(524288) })).toThrow(
			"source_too_large",
		);
		expect(() =>
			portableSourceFilesystem({
				...source,
				fragments: Array.from({ length: 129 }, (_, i) => ({ path: `${i}.toml`, toml: "" })),
			}),
		).toThrow("source_too_large");
		expect(() =>
			portableSourceFilesystem({
				...source,
				fragments: Array.from({ length: 128 }, (_, i) => ({ path: `${i}.toml`, toml: "" })),
			}),
		).not.toThrow();
	});
});
