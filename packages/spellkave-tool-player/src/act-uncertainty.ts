/** Missing completion evidence is neither a refusal nor proof of no effect. */
export const UNCONFIRMED_OUTCOME_MESSAGE = "The outcome could not be confirmed.";

export function isUnobservedActStatus(status: string): boolean {
	return (
		status === "unobservable" ||
		status === "unobserved_timeout" ||
		status === "unobserved_no_provenance"
	);
}
