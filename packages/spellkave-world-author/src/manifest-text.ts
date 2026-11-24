/** Strip root-only headers when rendering a row-only include fragment. */
export function stripManifestHeaders(rendered: string): string {
	const dropHeaders = new Set(["[[bundles]]", "[metadata]"]);
	const kept: string[] = [];
	let seenTable = false;
	let dropping = false;
	for (const line of rendered.split("\n")) {
		const table = line.trim();
		if (/^\[\[?[A-Za-z_.]+\]?\]$/.test(table)) {
			seenTable = true;
			dropping = dropHeaders.has(table);
			if (!dropping) kept.push(line);
			continue;
		}
		if (seenTable && !dropping) kept.push(line);
	}
	return `${kept
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}
