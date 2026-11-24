import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

// Workspace tooling resolves extensionless TypeScript imports. Node ESM and
// NodeNext declaration consumers need the emitted file name instead.
export function prepareEsmDirectory(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			prepareEsmDirectory(path);
		} else if (path.endsWith(".js") || path.endsWith(".d.ts")) {
			rewriteImports(path);
		}
	}
}

function rewriteImports(path) {
	let code = readFileSync(path, "utf8");
	const imports = ts.preProcessFile(code, true, true).importedFiles;
	for (const { fileName, pos, end } of imports.reverse()) {
		if (!/^\.\.?\//.test(fileName)) continue;
		const directory = dirname(path);
		if (fileExists(join(directory, fileName))) continue;
		const stem = fileName.replace(/\.ts$/, "");
		const alternatives = [`${stem}.js`, `${stem}/index.js`];
		const replacement = alternatives.find((candidate) => fileExists(join(directory, candidate)));
		if (!replacement) throw new Error(`No emitted module for ${fileName} in ${path}`);
		code = code.slice(0, pos + 1) + replacement + code.slice(end + 1);
	}

	// The maps describe the original tsc output and its workspace sources.
	writeFileSync(path, code.replace(/\n\/\/# sourceMappingURL=[^\n]+\s*$/, "\n"));
}

function fileExists(path) {
	return statSync(path, { throwIfNoEntry: false })?.isFile();
}
