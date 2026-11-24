import { describe, expect, it } from "vitest";

import {
	decodeCursor,
	parseQueryHandle,
	QueryProtocolError,
	queryHandle,
	queryPage,
	queryRevision,
} from "../query-protocol";

describe("bounded query protocol", () => {
	it("hashes canonical object key order and bigint deterministically", () => {
		expect(queryRevision("scene", [{ b: 2n, a: 1 }])).toBe(
			queryRevision("scene", [{ a: 1, b: 2n }]),
		);
	});

	it("pages with truthful counts and an opaque revision-bound cursor", () => {
		const first = queryPage({ domain: "trace", rows: ["a", "b", "c"], limit: 2 });
		expect(first).toMatchObject({
			listing: "paginated",
			shown: 2,
			matched: 3,
			truncated: true,
			items: ["a", "b"],
		});
		expect(first.next_cursor).not.toContain("trace");
		const firstCursor = first.next_cursor;
		if (firstCursor === null) throw new Error("expected continuation cursor");
		const second = queryPage({
			domain: "trace",
			rows: ["a", "b", "c"],
			limit: 2,
			cursor: firstCursor,
		});
		expect(second).toMatchObject({
			listing: "paginated",
			shown: 1,
			matched: 3,
			truncated: false,
			next_cursor: null,
			items: ["c"],
		});
	});

	it("rejects stale and cross-domain cursors", () => {
		const page = queryPage({ domain: "inventory", rows: [1, 2], limit: 1 });
		const cursor = page.next_cursor;
		if (cursor === null) throw new Error("expected continuation cursor");
		expect(() => decodeCursor(cursor, "scene", page.rev)).toThrowError(
			new QueryProtocolError("cross_domain"),
		);
		expect(() => decodeCursor(cursor, "inventory", "changed")).toThrowError(
			new QueryProtocolError("stale_cursor"),
		);
	});

	it("uses domain-prefixed handles and rejects cross-domain reuse", () => {
		expect(queryHandle("reaction", 3)).toBe("r3");
		expect(parseQueryHandle("r3", "reaction", 4)).toBe(3);
		expect(() => parseQueryHandle("r3", "trace", 4)).toThrowError(
			new QueryProtocolError("cross_domain"),
		);
		expect(() => parseQueryHandle("r4", "reaction", 4)).toThrowError(
			new QueryProtocolError("unknown_handle"),
		);
	});

	it("always emits a terminal null cursor, including an empty domain", () => {
		expect(queryPage({ domain: "self", rows: [] }).next_cursor).toBeNull();
		expect(queryPage({ domain: "scene", rows: [1] }).next_cursor).toBeNull();
	});

	it("caps caller limits and never permits an unbounded zero", () => {
		const rows = Array.from({ length: 150 }, (_, i) => i);
		expect(queryPage({ domain: "scene", rows, limit: 1_000 }).shown).toBe(100);
		expect(queryPage({ domain: "scene", rows, limit: 0 }).shown).toBe(1);
	});
});
