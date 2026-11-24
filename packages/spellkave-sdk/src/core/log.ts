type LogSink = (line: string) => void;

function defaultSink(line: string): void {
	if (typeof process !== "undefined" && process.stderr?.write) {
		process.stderr.write(`${line}\n`);
	} else {
		console.warn(line);
	}
}

let _sink: LogSink = defaultSink;

export function setLogSink(fn: LogSink): void {
	_sink = fn;
}

function bigintReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

export function logKind(kind: string, fields: Record<string, unknown>): void {
	_sink(JSON.stringify({ kind, ...fields }, bigintReplacer));
}
