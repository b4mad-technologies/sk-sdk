/** crates/spellkave-schema SERVICE_ONLY_AUDIENCE_TAG. A capability whose
 * definition carries it is a metadata audience for service identities only:
 * the server gives a person no document through it
 * (`visible_metadata_attachment`). Every read capability of private NPC
 * configuration carries it. A test reads the Rust constant. */
export const SERVICE_ONLY_AUDIENCE_TAG = "core.service_only_audience";

/** The `capability_definition_tag` marker row for one read capability. */
export const serviceOnlyAudienceTag = (bundle: string, capability: string) => ({
	bundle_id: bundle,
	capability_id: capability,
	tag: SERVICE_ONLY_AUDIENCE_TAG,
	source: "manifest",
});
