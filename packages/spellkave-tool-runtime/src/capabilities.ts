/** Stable error raised when a host composes a tool without a required port. */
export const TOOL_CAPABILITY_UNAVAILABLE = "tool_capability_unavailable";

export class ToolCapabilityUnavailableError extends Error {
	readonly code = TOOL_CAPABILITY_UNAVAILABLE;
	readonly toolName: string;
	readonly capability: string;

	constructor(toolName: string, capability: string) {
		super(`Tool '${toolName}' requires unavailable capability '${capability}'.`);
		this.name = "ToolCapabilityUnavailableError";
		this.toolName = toolName;
		this.capability = capability;
	}
}

/** Filesystem and path operations supplied by a host, never by the runtime. */
export interface FilesystemPort {
	exists(path: string): boolean;
	isFile(path: string): boolean;
	readText(path: string): string;
	writeText(path: string, content: string): void;
	ensureDirectory(path: string): void;
	dirname(path: string): string;
	join(...parts: string[]): string;
	resolve(...parts: string[]): string;
	moduleDirectory(moduleUrl: string): string;
}

/** Raster persistence is a host edge: render domain code supplies SVG and metadata. */
export interface RasterOutputPort {
	writeJpeg(input: {
		outputDir: string | undefined;
		outputName: string | undefined;
		graph: string | undefined;
		svg: string;
		width: number;
		layerRows: readonly Record<string, unknown>[];
	}): Promise<{ jpgPath: string }>;
}

/** Node-only map asset and image-result operations; SVG geometry stays host-neutral. */
export interface NodeMapPort extends RasterOutputPort {
	mapLayersToBackdrops(rows: readonly Record<string, unknown>[]): {
		backdrops: readonly unknown[];
		resolved: number;
		skipped: number;
	};
	backdropAssetDataHref(backdrop: unknown): string | null;
	attachSpatialGraphImage<T extends { details: object }>(result: T): Promise<T>;
	probeAssetDimensions(input: {
		assetModule: string;
		assetPath: string;
	}): { width: number; height: number } | undefined;
}

export interface ToolRunEmitter {
	emit(kind: string, payload: Record<string, unknown>): void;
}

export interface ToolTelemetryPort {
	createRunEmitter(input: Record<string, unknown>): ToolRunEmitter;
}

/** One deliberate Node opt-in supplied by a Node/Pi adapter, never defaulted by a tool body. */
export interface NodeToolCapability {
	filesystem: FilesystemPort;
	map: NodeMapPort;
	telemetry: ToolTelemetryPort;
}

export interface NodeToolCapabilities {
	node?: NodeToolCapability;
}
