/** Explicit selected file sources only; no live SQL/cache or implicit union. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	type AuthorWorkspace,
	EXPLORATION_MANIFEST_KINDS,
	type ExplorationPort,
	ExplorationSourceError,
	projectExplorationManifest,
} from "@spellkave/tool-authoring";
import { inspectManifest, ManifestRootMissingError } from "@spellkave/world-author";
import { nodeFilesystem } from "../filesystem";
import { createLocalAuthorTarget, LocalAuthorDependencyError } from "./local-target";

const describe = (error: unknown) =>
	(error instanceof Error ? error.message : String(error)).replace(
		/^loadBundleChainDetailed: /,
		"",
	);
export function createFileExplorationPort(options: {
	workspace: AuthorWorkspace;
	workspacePath: string;
	localPath?: string;
	fixturesRoot?: string;
	dependencyManifests?: Readonly<Record<string, string>>;
}): ExplorationPort {
	const sourceId = (path: string) => createHash("sha256").update(resolve(path)).digest("hex");
	return {
		async snapshot(source) {
			if (source === "live") throw new Error("reader_unavailable");
			let manifest: Record<string, unknown>;
			let path: string;
			if (source === "workspace") {
				path = options.workspacePath;
				try {
					const toml = options.workspace.readToml();
					manifest =
						toml === null ? {} : (inspectManifest(toml).manifest as Record<string, unknown>);
				} catch (error) {
					throw new ExplorationSourceError(
						`workspace ${path} is not readable: ${describe(error)}`,
						"Fix the TOML in the --workspace directory, or pass another one with --workspace <dir>.",
					);
				}
			} else {
				if (!options.localPath)
					throw new ExplorationSourceError(
						"source local needs a manifest, but no --target was given.",
						"Pass --target <manifest.toml or a directory holding manifest.toml> before the command.",
					);
				path = options.localPath;
				const root = path.endsWith(".toml") ? path : nodeFilesystem.join(path, "manifest.toml");
				if (!nodeFilesystem.exists(root))
					throw new ExplorationSourceError(
						`manifest not found: ${resolve(root)}`,
						"--target must name a manifest .toml file or a directory that holds manifest.toml.",
					);
				try {
					// Refresh the complete include/dependency closure for every call; legacy target caching does not certify a current file snapshot.
					const target = createLocalAuthorTarget(path, {
						fixturesRoot: options.fixturesRoot,
						dependencyManifests: options.dependencyManifests,
					});
					manifest = Object.fromEntries(
						EXPLORATION_MANIFEST_KINDS.map((kind) => [kind, target.lookup(kind)]),
					);
				} catch (error) {
					throw new ExplorationSourceError(
						error instanceof ManifestRootMissingError
							? describe(error)
							: `reading ${resolve(root)} and its dependencies failed: ${describe(error)}`,
						error instanceof LocalAuthorDependencyError
							? `Map it once: sk config set --project author.dependencies.${error.bundleId} <manifest.toml> (repository defaults: .spellkave/defaults.toml), or pass --fixtures-root <dir> holding ${error.bundleId}/manifest.toml.`
							: error instanceof ManifestRootMissingError
								? "Configure each bundle once with sk config set --project author.dependencies.<bundle-id> <manifest.toml>. Unmapped IDs use <fixtures-root>/<bundle_id>/manifest.toml (default fixtures-root: the parent of the manifest's directory). In sk, --fixtures-root <dir> overrides configured mappings for that call."
								: "Fix the manifest named by --target; `sk validate <manifest> --bundle` reports what is wrong.",
					);
				}
			}
			return projectExplorationManifest(manifest, {
				source,
				source_id: sourceId(path),
				world: null,
				world_instance: null,
				connection_epoch: "files-v1",
			});
		},
	};
}
