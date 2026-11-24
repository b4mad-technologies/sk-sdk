// Node-only lifecycle: sockets, spawn, and the daemon process. Subpath
// export `@spellkave/session/node` — the isomorphic core lives at the
// package root (`@spellkave/session`, `../index.ts`).

export {
	type AttachSessionDaemonOptions,
	attachSessionDaemon,
	DEFAULT_SESSION_REQUEST_TIMEOUT_MS,
	type EnsureDaemon,
	requireSessionResult,
	type SendSessionRequestOptions,
	SessionDaemonClient,
	type SessionDaemonHello,
	SessionDaemonProtocolError,
	SessionDaemonResponseError,
	type SessionDaemonStatus,
	SessionDaemonTransportError,
	sendSessionRequest,
} from "./client.ts";
export * from "./connection-controller.ts";
export {
	type DaemonHandle,
	DEFAULT_IDLE_TIMEOUT_MS,
	DEFAULT_METRICS_HEARTBEAT_INTERVAL_MS,
	type DispatcherOptions,
	type InvokableTool,
	type ServeDaemonOptions,
	SessionDispatcher,
	type StartDaemonOptions,
	serveDaemon,
	startDaemon,
} from "./daemon.ts";
export {
	type ApplyLiveDeltaOptions,
	applyLiveDelta,
	connectSetupSession,
	isManifestAlreadyApplied,
} from "./live-delta.ts";
export {
	type CreateSessionRunObserverOptions,
	createSessionCausalTelemetry,
	createSessionRunObserver,
	DEFAULT_RUN_EVENTS_MAX_BYTES,
	DEFAULT_RUN_EVENTS_ROOT_MAX_BYTES,
	OFF_SESSION_RUN_OBSERVER,
	otlpLogsHeadersFromEnv,
	parseRunEventsMaxBytes,
	parseRunEventsMode,
	parseRunEventsRootMaxBytes,
	RUN_EVENTS_ENV,
	RUN_EVENTS_MAX_BYTES_ENV,
	RUN_EVENTS_MODES,
	RUN_EVENTS_OTLP_ENDPOINT_ENV,
	RUN_EVENTS_ROOT_MAX_BYTES_ENV,
	type RunEventsMode,
	resolveReducerAttemptTelemetry,
	SESSION_METRICS_SERVICE_NAME,
	SESSION_RUN_DRIVER,
	type SessionCausalTelemetry,
	type SessionRunObserver,
	type SessionRunObserverStatus,
	sessionRunArtifactPath,
} from "./observability.ts";
export {
	bindingHash12,
	ensureParentDir,
	logPath,
	restrictSocketPermissions,
	runEventsPath,
	runtimeDir,
	sha256HexNode,
	socketPath,
} from "./paths.ts";
export * from "./player-run-observer.ts";
export {
	type DrainPushesRequest,
	type ErrorDetail,
	type ErrResponse,
	encodeFrame,
	type HelloRequest,
	type InvokeRequest,
	isErrResponse,
	isOkResponse,
	isRequest,
	isResponse,
	JsonlFrameDecoder,
	type OkResponse,
	PROTOCOL_VERSION,
	type Request,
	type Response,
	requestId,
	type SessionNotice,
	type ShutdownRequest,
	type StatusRequest,
} from "./protocol.ts";
export {
	DAEMON_ENV,
	type DaemonAttachment,
	type DaemonCommand,
	type EnsureDaemonOptions,
	ensureDaemon,
	probeSocket,
	type SpawnDaemonFn,
	type SpawnedProcessLike,
} from "./spawn.ts";
export {
	createSessionWorldEventFeed,
	type SessionWorldEventFeed,
	type SessionWorldEventFeedDeps,
} from "./world-events.ts";
