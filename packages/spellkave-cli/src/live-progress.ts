/** Opt-in publisher subprocess diagnostics: fixed stage names, no caller data. */
export type LiveAuthorStage =
	| "connect"
	| "initial_subscription"
	| "owner_subscription"
	| "manifest_subscription"
	| "enqueue"
	| "manifest_result";

export function liveAuthorProgress(stage: LiveAuthorStage): void {
	if (process.env.SPELLKAVE_AUTHOR_PROGRESS === "1")
		process.stderr.write(JSON.stringify({ schema: "spellkave-author-progress/v1", stage }) + "\n");
}
