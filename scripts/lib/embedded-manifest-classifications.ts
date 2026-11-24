/** A policy owns discovery; each discovered file owns its classification rationale. */
export interface EmbeddedManifestRule {
	/** Policy identifier; also the accepted category unless alternatives are supplied. */
	category: string;
	/** Exactly one of these reviewed categories may classify a matching source file. */
	allowedCategories?: readonly string[];
	/** Optional overlapping discovery checks whose memberships the header must preserve. */
	signatures?: readonly {
		name: string;
		matches: (source: string, path: string) => boolean;
	}[];
	minimumRationaleLength: number;
	matches: (source: string, path: string) => boolean;
}

/**
 * Read one JSON object per `// embedded-manifest:` header line. Multiple distinct
 * categories are allowed when a source file satisfies more than one policy.
 * This is classification only: it never grants a schema-validation exemption.
 */
export function checkEmbeddedManifestClassifications(
	files: readonly { path: string; source: string }[],
	rules: readonly EmbeddedManifestRule[],
): string[] {
	const failures: string[] = [];
	for (const { path, source } of files) {
		const seen = new Set<string>();
		let inHeader = true;
		let inBlock = false;
		for (const [index, line] of source.split("\n").entries()) {
			const text = line.trim();
			const marker = /^\/\/\s*embedded-manifest:(.*)$/.exec(text);
			if (marker) {
				const fail = (message: string) => failures.push(`${path}:${index + 1}: ${message}`);
				if (!inHeader || inBlock) {
					fail("classification must be in the initial comment header");
					continue;
				}
				let value: unknown;
				try {
					value = JSON.parse(marker[1] ?? "");
				} catch {
					fail("malformed classification JSON");
					continue;
				}
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					fail("classification must be an object");
					continue;
				}
				const fields = value as Record<string, unknown>;
				const rule = rules.find((entry) =>
					(entry.allowedCategories ?? [entry.category]).some(
						(category) => category === fields.category,
					),
				);
				const expectedFields = rule?.signatures
					? "category,rationale,signatures"
					: "category,rationale";
				if (!rule || Object.keys(fields).sort().join(",") !== expectedFields) {
					fail("invalid classification category or fields");
					continue;
				}
				if (seen.has(rule.category)) fail(`duplicate ${rule.category} classification`);
				seen.add(rule.category);
				if (
					typeof fields.rationale !== "string" ||
					fields.rationale.trim().length <= rule.minimumRationaleLength
				)
					fail(`rationale must exceed ${rule.minimumRationaleLength} characters`);
				if (!rule.matches(source, path)) fail(`stale ${rule.category} classification`);
				const signatures = rule.signatures;
				if (signatures) {
					const declared = fields.signatures;
					if (
						!Array.isArray(declared) ||
						declared.length === 0 ||
						new Set(declared).size !== declared.length ||
						declared.some((name) => !signatures.some((entry) => entry.name === name))
					) {
						fail("invalid classification signatures");
					} else {
						for (const signature of signatures) {
							const matches = signature.matches(source, path);
							if (matches && !declared.includes(signature.name))
								fail(`missing ${signature.name} signature`);
							if (!matches && declared.includes(signature.name))
								fail(`stale ${signature.name} signature`);
						}
					}
				}
				continue;
			}
			if (index === 0 && text.startsWith("#!")) continue;
			// Consume leading JS/TS comment blocks without accepting executable code
			// after a closing delimiter as part of the header.
			if (inBlock) {
				const end = text.indexOf("*/");
				if (end >= 0) {
					inBlock = false;
					if (text.slice(end + 2).trim()) inHeader = false;
				}
			} else if (text.startsWith("/*")) {
				const end = text.indexOf("*/", 2);
				inBlock = end < 0;
				if (end >= 0 && text.slice(end + 2).trim()) inHeader = false;
			} else if (text && !text.startsWith("//")) inHeader = false;
		}
		for (const rule of rules) {
			if (rule.matches(source, path) && !seen.has(rule.category))
				failures.push(`${path}: missing ${rule.category} classification`);
		}
	}
	return failures;
}
