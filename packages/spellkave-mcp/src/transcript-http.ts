import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PUBLIC_TRANSCRIPT_FILENAME } from "./transcript.ts";

/** Path shape: `/transcripts/<slug>` (no nested segments). */
const TRANSCRIPT_PATH = /^\/transcripts\/([a-z][a-z0-9-]{0,63})$/;

export function parseTranscriptSlug(pathname: string): string | null {
	const match = TRANSCRIPT_PATH.exec(pathname);
	return match?.[1] ?? null;
}

export type TranscriptFileReader = (absolutePath: string) => Promise<string | null>;

export const defaultTranscriptFileReader: TranscriptFileReader = async (absolutePath) => {
	try {
		return await readFile(absolutePath, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
};

/**
 * CORS for the browser website calling GET /transcripts/* with a WorkOS bearer.
 * Only attach when Origin hostname is on the gateway allowlist (same set as
 * originValidationResponse). Never `*`.
 */
export function websiteCorsHeaders(
	request: Request,
	allowedOriginHostnames: readonly string[],
): Record<string, string> | undefined {
	const origin = request.headers.get("origin");
	if (origin === null || origin === "") return undefined;
	let hostname: string;
	try {
		hostname = new URL(origin).hostname.toLowerCase();
	} catch {
		return undefined;
	}
	if (!allowedOriginHostnames.map((h) => h.toLowerCase()).includes(hostname)) {
		return undefined;
	}
	return {
		"access-control-allow-origin": origin,
		"access-control-allow-credentials": "true",
		"access-control-allow-methods": "GET, OPTIONS",
		"access-control-allow-headers": "authorization, content-type",
		"access-control-max-age": "600",
		vary: "Origin",
	};
}

export function transcriptPreflightResponse(
	request: Request,
	allowedOriginHostnames: readonly string[],
): Response {
	const cors = websiteCorsHeaders(request, allowedOriginHostnames) ?? {};
	return new Response(null, {
		status: 204,
		headers: {
			...cors,
			"cache-control": "no-store",
		},
	});
}

export interface ServeTranscriptOptions {
	directory: string;
	slug: string;
	publicSlugs: ReadonlySet<string>;
	readFile?: TranscriptFileReader;
	cors?: Record<string, string>;
}

/** Stream one public catalog world's JSONL. No seat check — any valid bearer. */
export async function servePublicTranscript(options: ServeTranscriptOptions): Promise<Response> {
	const cors = options.cors ?? {};
	if (!options.publicSlugs.has(options.slug)) {
		return new Response("Not found.", {
			status: 404,
			headers: { ...cors, "cache-control": "no-store" },
		});
	}
	const directory = options.directory.trim();
	if (directory === "") {
		return new Response("Not found.", {
			status: 404,
			headers: { ...cors, "cache-control": "no-store" },
		});
	}
	const absolutePath = join(directory, options.slug, PUBLIC_TRANSCRIPT_FILENAME);
	const reader = options.readFile ?? defaultTranscriptFileReader;
	const body = await reader(absolutePath);
	if (body === null) {
		// Empty feed is still a successful login-gated read (no rows yet).
		return new Response("", {
			status: 200,
			headers: {
				...cors,
				"content-type": "application/x-ndjson; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}
	return new Response(body, {
		status: 200,
		headers: {
			...cors,
			"content-type": "application/x-ndjson; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}
