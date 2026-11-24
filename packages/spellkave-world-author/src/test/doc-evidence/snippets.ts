// Snippet-extraction helper for authoring-doc-evidence task 5.1 (sk-e0u.5):
// pulls a fenced code block's raw bytes straight out of a `docs/*.md` file,
// keyed by a `<!-- snippet: <id> -->` marker comment on the line immediately
// above the opening fence. This makes the COMMITTED doc bytes themselves the
// test input for the doc-evidence declarations that merge a snippet into a
// minimal manifest skeleton and run it through `validateManifestToml` — a
// snippet can no longer silently drift from the schema without a red test.
//
// Deliberately dumb: no Markdown parser, one regex, exact marker match. A
// duplicate marker or a marker with no following fence throws at test-collection
// time (a loud authoring error, not a silently empty snippet).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS_DIR = fileURLToPath(new URL("../../../docs/", import.meta.url));

export interface ExtractedSnippet {
	lang: string;
	content: string;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the fenced code block immediately following
 * `<!-- snippet: <id> -->` in `docs/<docId>.md`. Returns the fence's
 * language tag and its raw content (no leading/trailing blank line, fence
 * lines themselves excluded).
 */
export function extractSnippet(docId: string, id: string): ExtractedSnippet {
	const path = `${DOCS_DIR}${docId}.md`;
	const source = readFileSync(path, "utf8");
	const marker = `<!-- snippet: ${id} -->`;
	const pattern = new RegExp(`${escapeRegExp(marker)}\\n\`\`\`(\\S+)\\n([\\s\\S]*?)\\n\`\`\``);
	const match = source.match(pattern);
	if (!match) {
		throw new Error(
			`no fenced block follows marker "${marker}" in ${path} — the marker moved, was renamed, or its fence was deleted`,
		);
	}
	const [, lang, content] = match;
	if (!lang || content === undefined) {
		throw new Error(`unreachable: marker "${marker}" matched but lang/content missing`);
	}
	return { lang, content };
}
