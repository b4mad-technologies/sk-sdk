/**
 * Churn-guarded JPEG write for a caller-supplied output directory — the SAME
 * sha256(svg + width) provenance-sidecar pattern
 * `packages/spellkave-srd-cc/src/author/elven-mini/renders.ts` established
 * for the AUTHOR-side "with-map" product renders, generalized into a small
 * reusable helper so `spellkave_map`'s (and `spellkave_map_graph`'s)
 * `output_type: "jpg"` mode (shared tool runtime `tools.ts`/`authoring-verbs.ts`)
 * doesn't hand-roll a second copy. `resolveMapJpegOutput` below is the
 * companion piece — output_dir/output_name default resolution (bead sk-due).
 *
 * PNG -> JPEG (operator decision, 2026-08-13): a full-resolution backdrop
 * PNG runs 1.1-1.4 MB, well over the repo's `check-added-large-files
 * --maxkb=1024` pre-commit gate. Mirrors `renders.ts`'s own established
 * product-view path exactly: rasterize to PNG via resvg (still a PNG buffer
 * at this stage — `rasterizeSvgToPng` is unchanged, resvg has no native JPEG
 * output), write it to a dot-prefixed temp file, shell out to
 * `ffmpeg -q:v 4` to encode the JPEG, then delete the temp PNG.
 *
 * ffmpeg on CI (sk-zgbj, corrects this header's earlier "never on a CI
 * runner" claim): srd-integration.yml's story job DOES re-record the
 * elven-mini playthrough on a runner, and #2442's first execution died on
 * `spawnSync ffmpeg ENOENT` there. The churn guard below hides that whenever
 * the committed art is current — an unchanged source skips rasterize+encode
 * entirely — so the ENOENT only appears once the source actually drifts,
 * which is the worst possible moment for a confusing error. `textOnly` (see
 * `writeJpegWithChurnGuard`) is the CI answer, mirroring the author-side
 * `SRD_CC_AUTHOR_CHECK_TEXT_ONLY` idiom in
 * `packages/spellkave-srd-cc/src/author/elven-mini/renders.ts` — it produces
 * nothing AND compares nothing.
 *
 * Why a hash sidecar and not a byte-diff: encoded bytes are host-dependent
 * (fonts + native resvg build + ffmpeg version), so two machines rendering
 * the SAME logical map can produce different bytes — comparing raw bytes
 * would rewrite the file on every re-record.
 *
 * The hash therefore uses a HOST-INDEPENDENT source: the raster width, the
 * SVG with host-resolved backdrop `href=` payloads normalised away, and a
 * stable fingerprint of the authored `map_layers` rows that identify those
 * backdrops. That keeps real graph/SVG changes visible (style, labels,
 * topology, layout) while excluding the machine-local terms that made the old
 * `sha256(width + "\n" + svg)` claim false in practice (absolute `file://`
 * URLs and embedded `data:` payloads reaching the SVG). Proof target: two
 * consecutive recordings leave `git status` clean, and the same logical input
 * hashed from two checkout-path contexts produces the same digest.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { rasterizeSvgToPng } from "./rasterize.ts";

const PROVENANCE_FILE = "provenance.json";

/**
 * Skip PRODUCING the binary (keep recording its provenance) — the same
 * portability escape hatch `renders.ts` exposes as
 * `SRD_CC_AUTHOR_CHECK_TEXT_ONLY`, under its own name because this writer
 * serves `spellkave_map`'s tool path rather than the author check. Read per
 * call, never cached, so a test can flip it around a single write.
 */
function textOnlyMode(): boolean {
	return process.env.SPELLKAVE_MAP_JPEG_TEXT_ONLY === "1";
}

const HOST_DEPENDENT_BACKDROP_HREF = /href="(?:data:[^"]*|file:[^"]*)"/g;

function stableRowFingerprint(rows: readonly Record<string, unknown>[]): string {
	return JSON.stringify(
		rows
			.map((row) =>
				Object.keys(row)
					.sort()
					.map((key) => [key, row[key]] as const),
			)
			.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
	);
}

export function mapLayerFingerprint(layerRows: readonly Record<string, unknown>[]): string {
	return stableRowFingerprint(layerRows);
}

export function provenanceHash(svg: string, width: number, layerFingerprint = ""): string {
	const assetIndependentSvg = svg.replace(HOST_DEPENDENT_BACKDROP_HREF, 'href="[backdrop]"');
	return createHash("sha256")
		.update(`${width}\n${layerFingerprint}\n${assetIndependentSvg}`)
		.digest("hex");
}

/** `null` = no sidecar on disk yet (first write into this directory). */
function loadProvenance(dir: string): Record<string, string> | null {
	try {
		const parsed = JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
	} catch {
		return null;
	}
}

function writeProvenance(dir: string, provenance: Record<string, string>): void {
	const sorted: Record<string, string> = {};
	for (const [key, hash] of Object.entries(provenance).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		sorted[key] = hash;
	}
	writeFileSync(join(dir, PROVENANCE_FILE), `${JSON.stringify(sorted, null, "\t")}\n`, "utf8");
}

/**
 * True when the existing binary at `path` can be trusted as-is: its recorded
 * provenance hash still matches (source unchanged), or the sidecar is
 * missing entirely — the ONE-TIME bootstrap (first write after this feature
 * landed, or a caller-managed directory that predates the sidecar) trusts
 * whatever is already on disk rather than forcing a rewrite of every file.
 */
function canSkipRewrite(
	path: string,
	filename: string,
	hash: string,
	oldProvenance: Record<string, string> | null,
): boolean {
	if (!existsSync(path)) return false;
	if (oldProvenance === null) return true;
	return oldProvenance[filename] === hash;
}

export interface WriteJpegResult {
	/** Absolute path the JPEG was (or already was) written to. */
	path: string;
	/** True when this call actually rasterized + encoded + wrote new bytes. */
	written: boolean;
}

/**
 * Write `<dir>/<baseName>.jpg`, rasterized from `svg` at `width` via resvg
 * then encoded via `ffmpeg -q:v 4` (same quality renders.ts's own
 * `*-with-map.jpg` product views use) — but only when the deterministic
 * source changed since the last write into `dir` (see module header). `dir`
 * and `baseName` are ALWAYS caller-supplied (no ambient/hardcoded location)
 * — see `spellkave_map`'s own `output_dir`/`output_name` params
 * (`resolveMapJpegOutput` below fills in a temp dir / derived name when a
 * caller omits either).
 */
export async function writeJpegWithChurnGuard(
	dir: string,
	baseName: string,
	svg: string,
	width: number,
	layerFingerprint = "",
): Promise<WriteJpegResult> {
	mkdirSync(dir, { recursive: true });
	const filename = `${baseName}.jpg`;
	const path = join(dir, filename);
	const hash = provenanceHash(svg, width, layerFingerprint);
	const oldProvenance = loadProvenance(dir);
	let written = false;
	if (!canSkipRewrite(path, filename, hash, oldProvenance)) {
		if (textOnlyMode()) {
			// sk-zgbj (corrected): touch NOTHING on disk — not the JPEG, and
			// deliberately not the sidecar either.
			//
			// The first cut wrote the new hash here, on the theory that the
			// sidecar is a reproducible text stand-in for the binary. It is
			// not. The old `sha256(width + "\\n" + svg)` hash included host-
			// resolved backdrop `href=` payloads, so a foreign host could miss
			// even when the logical map matched. That is also the real trigger
			// behind this bead's original ENOENT — the guard never matched on
			// a foreign host, so it always reached for ffmpeg; stale content
			// merely made it look content-shaped. Writing the hash therefore
			// did not report drift, it MANUFACTURED a diff on every runner and
			// would have made the story gate permanently red (caught in #2459
			// before that gate went live).
			//
			// So this mirrors the author side exactly: renders.ts's `textOnly`
			// skips producing the binaries and its callers skip them on the
			// COMPARE side too. Map-art drift is consequently not a CI-visible
			// signal — it cannot be, on a host that can neither encode the
			// binary nor reproduce its hash. It is caught where the art is
			// actually regenerated: the local re-record.
			// eslint-disable-next-line no-console
			console.error(
				`[map-jpeg] ${filename}: SPELLKAVE_MAP_JPEG_TEXT_ONLY=1 — skipping ` +
					"rasterize+ffmpeg and leaving provenance.json untouched. If the SOURCE " +
					"genuinely changed, a local re-record refreshes both the JPEG and its hash.",
			);
			return { path, written: false };
		}
		const { png } = await rasterizeSvgToPng(svg, { width });
		// resvg has no native JPEG output — rasterize to a temp PNG, then shell
		// out to ffmpeg for the JPEG encode (same two-step renders.ts's own
		// `*-with-map.jpg` product views use), and delete the temp file.
		const tmpPng = join(dir, `.${baseName}.tmp.png`);
		writeFileSync(tmpPng, png);
		execFileSync("ffmpeg", ["-y", "-i", tmpPng, "-q:v", "4", path], { stdio: "pipe" });
		unlinkSync(tmpPng);
		written = true;
	}
	// Always persist (even on skip): a fresh bootstrap sidecar still needs this
	// entry recorded so the NEXT call in a different directory state compares
	// correctly, and re-sorting/re-writing an unchanged sidecar is idempotent.
	writeProvenance(dir, { ...(oldProvenance ?? {}), [filename]: hash });
	return { path, written };
}

/** `graph` (a place_graph_id) -> a filesystem-safe stem, e.g. "elven_mini/inn"
 * -> "elven-mini-inn". Falls back to "map" for a world-compose call (no graph
 * filter) or a graph id with no alphanumerics at all. */
function defaultMapName(graph: string | undefined): string {
	const trimmed = graph?.trim();
	if (!trimmed) return "map";
	const slug = trimmed
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "map";
}

export interface MapJpegOutputTarget {
	/** Absolute directory to actually write into. */
	dir: string;
	/** Base filename (no extension). */
	name: string;
	/** What the tool's response should echo as the `output_dir` half of
	 * `jpg_path` — the caller's OWN string verbatim when supplied (never
	 * resolved, so a relative input stays relative — see this module's own
	 * header on why that matters for a recorded artifact), or the same
	 * absolute temp dir actually used when defaulted (there is no
	 * caller-original to echo in that case). */
	echoDir: string;
}

/**
 * Resolve `output_dir`/`output_name` for `output_type: "jpg"` — BOTH stay
 * optional (bead sk-due): an omitted `output_dir` gets a fresh temp
 * directory (`mkdtempSync`), an omitted `output_name` gets one derived from
 * `graph` (or "map" for a world-compose call with no graph filter). Explicit
 * values are untouched — same relative-stays-relative contract
 * `writeJpegWithChurnGuard`'s own callers already prove (the srd-cc adventure
 * story recording needs stable repo-relative paths).
 */
export function resolveMapJpegOutput(
	outputDir: string | undefined,
	outputName: string | undefined,
	graph: string | undefined,
): MapJpegOutputTarget {
	const trimmedDir = outputDir?.trim();
	const trimmedName = outputName?.trim();
	const name = trimmedName && trimmedName.length > 0 ? trimmedName : defaultMapName(graph);
	if (trimmedDir !== undefined && trimmedDir.length > 0) {
		const dir = isAbsolute(trimmedDir) ? trimmedDir : join(process.cwd(), trimmedDir);
		return { dir, name, echoDir: trimmedDir };
	}
	const dir = mkdtempSync(join(tmpdir(), "spellkave-map-"));
	return { dir, name, echoDir: dir };
}
