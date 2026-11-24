import type { FilesystemPort } from "@spellkave/tool-runtime";

export interface PortableSource {
	root_path: string;
	root_toml: string;
	fragments: readonly { path: string; toml: string }[];
}

export class SourceInputError extends Error {
	constructor(
		readonly code: "invalid_source" | "source_too_large",
		detail: string,
	) {
		super(`${code}: ${detail}`);
		this.name = "SourceInputError";
	}
}

/** Logical relative names only. Reject traversal before normalization. */
export function sourcePath(path: string): string {
	if (!path || /[\\\0:]/.test(path) || path.startsWith("/") || path.split("/").includes(".."))
		throw new SourceInputError("invalid_source", `unsafe logical path '${path}'`);
	const normalized = path
		.split("/")
		.filter((part) => part !== "" && part !== ".")
		.join("/");
	if (!normalized) throw new SourceInputError("invalid_source", "empty logical path");
	return normalized;
}

/** No host port is consulted; the map is discarded after one invocation. */
export function portableSourceFilesystem(source: PortableSource): FilesystemPort {
	const encoder = new TextEncoder();
	const entries = [{ path: source.root_path, toml: source.root_toml }, ...source.fragments];
	if (
		source.fragments.length > 128 ||
		entries.reduce(
			(size, entry) =>
				size + encoder.encode(entry.path).byteLength + encoder.encode(entry.toml).byteLength,
			0,
		) >
			1024 * 1024
	)
		throw new SourceInputError("source_too_large", "source exceeds 1 MiB or 128 fragments");
	const files = new Map<string, string>();
	for (const entry of entries) {
		const path = sourcePath(entry.path);
		if (files.has(path))
			throw new SourceInputError("invalid_source", `duplicate logical path '${path}'`);
		files.set(path, entry.toml);
	}
	const forbidden = (): never => {
		throw new SourceInputError("invalid_source", "source map is read-only");
	};
	return {
		exists: (path) => files.has(sourcePath(path)),
		isFile: (path) => files.has(sourcePath(path)),
		readText: (path) => {
			const normalized = sourcePath(path);
			const text = files.get(normalized);
			if (text === undefined)
				throw new SourceInputError("invalid_source", `missing supplied fragment '${normalized}'`);
			return text;
		},
		dirname: (path) => {
			const normalized = sourcePath(path);
			return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ".";
		},
		join: (...parts) =>
			sourcePath(
				parts
					.filter((part) => part !== ".")
					.map(sourcePath)
					.join("/"),
			),
		resolve: (...parts) =>
			sourcePath(
				parts
					.filter((part) => part !== ".")
					.map(sourcePath)
					.join("/"),
			),
		writeText: forbidden,
		ensureDirectory: forbidden,
		moduleDirectory: forbidden,
	};
}
