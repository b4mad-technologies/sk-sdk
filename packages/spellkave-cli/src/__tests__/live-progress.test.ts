// keep-file(K1): opt-in subprocess diagnostic serialization must exclude caller data.
import { afterEach, expect, it, vi } from "vitest";
import { liveAuthorProgress } from "../live-progress.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});
it("emits only bounded stage markers when explicitly enabled", () => {
	const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	vi.stubEnv("SPELLKAVE_AUTHOR_PROGRESS", "");
	liveAuthorProgress("connect");
	expect(write).not.toHaveBeenCalled();
	vi.stubEnv("SPELLKAVE_AUTHOR_PROGRESS", "1");
	for (const stage of [
		"connect",
		"initial_subscription",
		"owner_subscription",
		"manifest_subscription",
		"enqueue",
		"manifest_result",
	] as const) {
		liveAuthorProgress(stage);
		expect(JSON.parse(String(write.mock.lastCall?.[0]))).toEqual({
			schema: "spellkave-author-progress/v1",
			stage,
		});
	}
	expect(write).toHaveBeenCalledTimes(6);
});
