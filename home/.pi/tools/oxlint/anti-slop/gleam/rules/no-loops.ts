import { defineRule } from "@oxlint/plugins";

import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree } from "@oxlint/plugins";

/** Allow iteration only through collection functions and `for...of`. */
export const noLoopsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow while, do-while, C-style for, and for-in loops outside `.ffi.ts` boundary modules.",
		},
		messages: {
			loop:
				"Replace this loop with `map`, `filter`, `flatMap`, `some`, `every`, `find`, or `for (const item of items)`. Use `Object.entries` instead of `for...in`. For repeat-until work such as retries, polling, or pagination, recurse with a counter parameter and return a failure at a named limit (`if (page >= MAX_PAGES) return err(...)`), because JavaScript recursion is not unbounded the way Gleam's is.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		const report = (node: ESTree.Node) => context.report({ node, messageId: "loop" });

		return {
			WhileStatement: report,
			DoWhileStatement: report,
			ForStatement: report,
			ForInStatement: report,
		};
	},
});
