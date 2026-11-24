/**
 * CLI: `world-map export <bundle-dir|rows.json> --xml … --json … --backdrops … --manifest …`
 * May use node:fs (not part of the pure library barrel).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { exportWorld } from "./export.ts";
import { OsmIdCollision } from "./ids.ts";
import { loadRowsSource } from "./load-bundle.ts";
import { renderOsmJsonString } from "./writers/json.ts";
import { renderOsmXml } from "./writers/xml.ts";

function usage(): string {
	return `Usage:
  world-map export <bundle-dir|rows.json> [options]

Options:
  --xml <path>         Write OSM XML 0.6
  --json <path>        Write OSM JSON (Overpass shape)
  --backdrops <path>   Write backdrops.json sidecar
  --manifest <path>    Write export-manifest.json
  --tick <n>           World tick (default 0)
  --timestamp <iso>    Element timestamp (default now)
  -h, --help           Show help
`;
}

function parseArgs(argv: string[]): {
	cmd: string;
	source?: string;
	xml?: string;
	json?: string;
	backdrops?: string;
	manifest?: string;
	tick: number;
	timestamp?: string;
	help: boolean;
} {
	const out: ReturnType<typeof parseArgs> = {
		cmd: "",
		tick: 0,
		help: false,
	};
	if (argv.length === 0) {
		out.help = true;
		return out;
	}
	// pnpm run may forward a bare `--` separator; skip it.
	const cleaned = argv[0] === "--" ? argv.slice(1) : argv;
	out.cmd = cleaned[0] ?? "";
	let i = 1;
	if (out.cmd === "export") {
		out.source = cleaned[i++];
	}
	while (i < cleaned.length) {
		const a = cleaned[i]!;
		if (a === "-h" || a === "--help" || a === "help") {
			out.help = true;
			i++;
			continue;
		}
		if (a === "--") {
			i++;
			continue;
		}
		const next = cleaned[i + 1];
		if (a === "--xml" && next) {
			out.xml = next;
			i += 2;
			continue;
		}
		if (a === "--json" && next) {
			out.json = next;
			i += 2;
			continue;
		}
		if (a === "--backdrops" && next) {
			out.backdrops = next;
			i += 2;
			continue;
		}
		if (a === "--manifest" && next) {
			out.manifest = next;
			i += 2;
			continue;
		}
		if (a === "--tick" && next) {
			out.tick = Number(next) || 0;
			i += 2;
			continue;
		}
		if (a === "--timestamp" && next) {
			out.timestamp = next;
			i += 2;
			continue;
		}
		throw new Error(`unknown argument: ${a}`);
	}
	return out;
}

async function ensureParent(path: string): Promise<void> {
	await mkdir(dirname(resolve(path)), { recursive: true });
}

export async function runCli(argv: string[]): Promise<number> {
	let args: ReturnType<typeof parseArgs>;
	try {
		args = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
		process.stderr.write(usage());
		return 2;
	}

	if (args.help || ["help", "-h", "--help", ""].includes(args.cmd)) {
		process.stdout.write(usage());
		return 0;
	}

	if (args.cmd !== "export") {
		process.stderr.write(`unknown command: ${args.cmd}\n`);
		process.stderr.write(usage());
		return 2;
	}

	if (!args.source) {
		process.stderr.write("export requires <bundle-dir|rows.json>\n");
		process.stderr.write(usage());
		return 2;
	}

	if (!args.xml && !args.json && !args.backdrops && !args.manifest) {
		process.stderr.write(
			"export requires at least one of --xml / --json / --backdrops / --manifest\n",
		);
		return 2;
	}

	try {
		const loaded = await loadRowsSource(args.source);
		const result = exportWorld(loaded.rows, {
			tick: args.tick,
			timestamp: args.timestamp,
		});

		if (args.xml) {
			await ensureParent(args.xml);
			await writeFile(args.xml, renderOsmXml(result.doc), "utf8");
		}
		if (args.json) {
			await ensureParent(args.json);
			await writeFile(args.json, renderOsmJsonString(result.doc), "utf8");
		}
		if (args.backdrops) {
			await ensureParent(args.backdrops);
			await writeFile(args.backdrops, JSON.stringify(result.backdrops, null, 2) + "\n", "utf8");
		}
		if (args.manifest) {
			await ensureParent(args.manifest);
			await writeFile(args.manifest, JSON.stringify(result.manifest, null, 2) + "\n", "utf8");
		}

		const m = result.manifest;
		process.stdout.write(
			JSON.stringify(
				{
					ok: true,
					source: loaded.manifestPath,
					counts: m.counts,
					unplaced_graphs: m.unplaced_graphs.map((u) => u.place_graph_id),
					diagnostics: m.diagnostics,
				},
				null,
				2,
			) + "\n",
		);
		return 0;
	} catch (err) {
		if (err instanceof OsmIdCollision) {
			process.stderr.write(`${err.message}\n`);
			return 1;
		}
		process.stderr.write(
			`world-map export failed: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return 1;
	}
}

// Direct execution via `tsx src/cli.ts`. The bin/ launchers import this module
// and call runCli themselves, so they must not match here: a match ran every
// launcher command twice (two summaries on stdout, every file written twice).
const isDirect =
	typeof process !== "undefined" &&
	process.argv[1] &&
	(process.argv[1].endsWith("/cli.ts") || process.argv[1].endsWith("\\cli.ts"));

if (isDirect) {
	const code = await runCli(process.argv.slice(2));
	process.exitCode = code;
}
