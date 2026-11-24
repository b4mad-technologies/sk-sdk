/** Public authored prose only; template specialization precedes action prose. */
import type { AffordanceTemplateRow } from "../../binding_rows";
import { asString } from "./_helpers";

export function actionDescriptionFields(
	actionText: unknown,
	templateIds: readonly string[],
	templates: ReadonlyMap<string, AffordanceTemplateRow>,
): { description?: string } {
	const description =
		templateIds
			.map((id) => asString(templates.get(id)?.description).trim())
			.find((text) => text.length > 0) ||
		asString(actionText).trim() ||
		undefined;
	return description === undefined ? {} : { description };
}
