// `@spellkave/sdk/profiles`: the persona-profile file contract without the
// bindings or a connection (paths, profile TOML, pointer reads). For hosts that
// only manage profiles, such as the `sk dev` plugin, and must not pull the
// generated bindings into their type check.

export * from "./credential";
export * from "./paths";
export * from "./profile";
export { readCurrentContext, readLastUsedProfile } from "./resolve";
