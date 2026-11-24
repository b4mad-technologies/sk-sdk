/** Resource-server facade. The gateway no longer operates an authorization server. */
export {
	createPlayerJwtVerifier,
	mcpResourceUrl,
	PLAYER_OAUTH_SCOPES_SUPPORTED,
	PLAYER_TOOLS_SCOPE,
	type PlayerJwtVerifier,
	type PlayerResourceServerConfig,
	PRM_MCP_PATH,
	PRM_PATH,
	protectedResourceMetadata,
	protectedResourceMetadataUrl,
	resourceServerFetch,
	unauthorizedResponse,
	wwwAuthenticate,
} from "@spellkave/gateway-identity";

/** @deprecated Use PlayerResourceServerConfig. Kept so existing imports compile during the cut. */
export type PlayerOAuthConfig = import("@spellkave/gateway-identity").PlayerResourceServerConfig;
