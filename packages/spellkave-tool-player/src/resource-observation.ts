/** Optional ruleset-selected PLAYER reads. No world knowledge or raw table access. */
export interface ResourceObservation {
	actionPrefix: string;
	actionSuffix?: string;
	stateId: string;
}
export const MAX_RESOURCE_READS = 4;

export async function observeOfferedResources(
	observations: readonly ResourceObservation[],
	actions: readonly { actionId: string }[],
	read: (stateId: string) => Promise<unknown>,
): Promise<{ items: unknown[]; omittedStateIds: string[] }> {
	const ids = [
		...new Set(
			observations
				.filter(
					({ actionPrefix, actionSuffix, stateId }) =>
						actionPrefix.length > 0 &&
						stateId.length > 0 &&
						actions.some(
							({ actionId }) =>
								actionId.startsWith(actionPrefix) &&
								(actionSuffix === undefined || actionId.endsWith(actionSuffix)),
						),
				)
				.map((row) => row.stateId),
		),
	];
	const items: unknown[] = [];
	for (const stateId of ids.slice(0, MAX_RESOURCE_READS)) {
		const page = await read(stateId);
		if (
			typeof page !== "object" ||
			page === null ||
			!("items" in page) ||
			!Array.isArray(page.items)
		)
			continue;
		// A prefix query may return siblings. Only explicitly returned exact rows
		// count; absent/omitted/truncated data never becomes an invented zero.
		for (const row of page.items) {
			if (typeof row === "object" && row !== null && "state_id" in row && row.state_id === stateId)
				items.push(row);
		}
	}
	return { items, omittedStateIds: ids.slice(MAX_RESOURCE_READS) };
}
