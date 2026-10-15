import { defineRule } from "@oxlint/plugins";

import { isBoundaryFile } from "../shared/boundary.ts";

/** Keep failure in function contracts by returning Result values instead of throwing. */
export const noThrowRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow throw outside `.ffi.ts` boundary modules; return a Result instead.",
		},
		messages: {
			throw:
				"Return a Result instead of throwing: `return { ok: false, error: { kind: \"NotFound\", id } }`. For an unrecoverable invariant, call a `panic` helper defined in a `.ffi.ts` boundary module.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		return {
			ThrowStatement(node) {
				context.report({ node, messageId: "throw" });
			},
		};
	},
});
