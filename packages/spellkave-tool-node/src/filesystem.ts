import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FilesystemPort } from "@spellkave/tool-runtime";

/** Node implementation of the runtime's narrow filesystem/path capability. */
export const nodeFilesystem: FilesystemPort = {
	exists: existsSync,
	isFile: (path) => statSync(path).isFile(),
	readText: (path) => readFileSync(path, "utf8"),
	writeText: (path, content) => writeFileSync(path, content, "utf8"),
	ensureDirectory: (path) => mkdirSync(path, { recursive: true }),
	dirname,
	join,
	resolve,
	moduleDirectory: (moduleUrl) => dirname(fileURLToPath(moduleUrl)),
};
