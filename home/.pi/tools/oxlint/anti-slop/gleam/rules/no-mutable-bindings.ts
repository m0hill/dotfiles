import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../../shared/scope.ts";
import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree, Variable } from "@oxlint/plugins";

function isBindingTarget(node: ESTree.Node): boolean {
	return node.type === "Identifier" || node.type === "ArrayPattern" || node.type === "ObjectPattern";
}

/**
 * Reports whether every reassignment of a binding happens inside a nested function, which makes it
 * long-lived state that callbacks update rather than a value computed in steps.
 */
function isCapturedState(variable: Variable): boolean {
	const writes = variable.references.filter((reference) => reference.isWrite() && !reference.init);
	const home = variable.scope.variableScope;
	return writes.length > 0 && writes.every((reference) => reference.from.variableScope !== home);
}

/** Keep every binding immutable so each name has exactly one value. */
export const noMutableBindingsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow let, var, and reassignment of bindings outside `.ffi.ts` boundary modules.",
		},
		messages: {
			mutableDeclaration:
				"Declare `{{kind}}` bindings with `const`. Compute the value in one expression, a helper function, or a `switch` that returns.",
			reassignment:
				"Do not reassign bindings. Bind the new value to a new `const` with a descriptive name.",
			capturedState:
				"`{{name}}` is long-lived state that callbacks change. Keep all such state in one `const state = { ... }` object owned by the function that sets it up, and change it only through that object.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		const sourceCode = context.sourceCode;

		const reportAssignment = (node: ESTree.Node, variable: Variable | null) => {
			if (variable !== null && isCapturedState(variable)) {
				context.report({ node, messageId: "capturedState", data: { name: variable.name } });
				return;
			}
			context.report({ node, messageId: "reassignment" });
		};

		return {
			VariableDeclaration(node) {
				if (node.kind !== "let" && node.kind !== "var") return;
				for (const declarator of node.declarations) {
					const variables = sourceCode.getDeclaredVariables(declarator);
					const captured = variables.length > 0 && variables.every(isCapturedState);
					if (captured) {
						const name = variables.map((variable) => variable.name).join("`, `");
						context.report({ node: declarator, messageId: "capturedState", data: { name } });
					} else {
						context.report({ node: declarator, messageId: "mutableDeclaration", data: { kind: node.kind } });
					}
				}
			},
			AssignmentExpression(node) {
				if (!isBindingTarget(node.left)) return;
				reportAssignment(node, node.left.type === "Identifier" ? resolveVariable(sourceCode, node.left) : null);
			},
			UpdateExpression(node) {
				if (node.argument.type === "Identifier") reportAssignment(node, resolveVariable(sourceCode, node.argument));
			},
		};
	},
});
