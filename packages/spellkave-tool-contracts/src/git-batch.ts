/** Strict framing for `git cat-file --batch`; sizes count bytes, including UTF-8 content. */
export function gitBatchInput(specs: readonly string[]): string {
	if (specs.some((spec) => /[\r\n\0]/.test(spec))) throw new Error("unsafe Git batch object name");
	return specs.length === 0 ? "" : `${specs.join("\n")}\n`;
}

export function parseGitBatch(
	specs: readonly string[],
	output: Uint8Array,
	decode: (bytes: Uint8Array) => string,
): ReadonlyMap<string, string | null> {
	gitBatchInput(specs);
	const files = new Map<string, string | null>();
	let offset = 0;
	for (const spec of specs) {
		const end = output.indexOf(10, offset);
		if (end < 0) throw new Error(`truncated Git batch header: ${spec}`);
		const header = decode(output.subarray(offset, end));
		offset = end + 1;
		if (header === `${spec} missing`) {
			files.set(spec, null);
			continue;
		}
		const match = /^(?:[a-f0-9]{40}|[a-f0-9]{64}) blob ([0-9]+)$/.exec(header);
		if (match === null) throw new Error(`invalid Git batch header: ${spec}`);
		const size = Number(match[1]);
		if (!Number.isSafeInteger(size) || size > output.length - offset - 1) {
			throw new Error(`truncated Git batch content: ${spec}`);
		}
		if (output[offset + size] !== 10) throw new Error(`invalid Git batch delimiter: ${spec}`);
		files.set(spec, decode(output.subarray(offset, offset + size)));
		offset += size + 1;
	}
	if (offset !== output.length) throw new Error("unexpected trailing Git batch output");
	return files;
}
