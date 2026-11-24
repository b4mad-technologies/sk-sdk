// Shared by the unit tests: capture what `sk` writes to stdout and stderr
// as lines, strip terminal colour and padding before a snapshot, and the
// fields a fake connection needs to read as the world's publisher.
import type { CliIo } from "../cli.ts";

/** Required publisher seam for an injected live port that is the publisher. */
export const publisherSeam = {
	readsAsPublisher: true,
	connectedIdentity: "publisher",
} as const;

/** A `CliIo` that captures both streams, so tests assert on lines, not process state. */
export function collect(options: { stdoutIsTTY?: boolean; stdoutColumns?: number } = {}): {
	io: CliIo;
	out: string[];
	err: string[];
} {
	const out: string[] = [];
	const err: string[] = [];
	return {
		io: {
			...options,
			out: (line) => out.push(line),
			err: (line) => err.push(line),
		},
		out,
		err,
	};
}

/** Terminal table renderers pad cells; that padding is not output semantics. */
export function snapshotText(lines: string[]): string {
	return lines
		.join("\n")
		.replace(new RegExp(`${String.fromCharCode(27)}[[0-9;]*m`, "g"), "")
		.replace(/[\t ]+$/gm, "");
}
