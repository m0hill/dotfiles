import { defineRule } from "@oxlint/plugins";

import { isBoundaryFile } from "../shared/boundary.ts";

/** Convert foreign exceptions to Result values once, inside boundary modules. */
export const noTryCatchRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow try statements outside `.ffi.ts` boundary modules.",
		},
		messages: {
			tryCatch:
				"Move this try statement into a `.ffi.ts` boundary module that wraps the throwing API and returns a Result. Callers handle the Result instead of catching. For an awaited promise, convert the rejection inline instead: `await promise.then(ok, (cause: unknown) => err(...))`.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		return {
			TryStatement(node) {
				context.report({ node, messageId: "tryCatch" });
			},
		};
	},
});
