import { defineRule } from "@oxlint/plugins";

import { isBoundaryFile } from "../shared/boundary.ts";

/** Use string literal or discriminated unions, which behave like Gleam custom types. */
export const noEnumsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow TypeScript enums outside `.ffi.ts` boundary modules.",
		},
		messages: {
			enum:
				"Replace this enum with a union: `type Status = \"active\" | \"suspended\"`, or a discriminated union when variants carry data.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		return {
			TSEnumDeclaration(node) {
				context.report({ node, messageId: "enum" });
			},
		};
	},
});
