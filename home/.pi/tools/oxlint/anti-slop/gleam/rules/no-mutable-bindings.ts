import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../../shared/scope.ts";
import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree, Scope, Variable } from "@oxlint/plugins";

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

/** A group of long-lived `let` or `var` bindings declared in one function or module scope. */
type StateGroup = { node: ESTree.Node; names: string[] };

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
				"Long-lived state that callbacks change: `{{names}}`. Keep all such state in one `const state = { ... }` object owned by the function that sets it up, and change it only through that object.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		const sourceCode = context.sourceCode;
		// One report per scope: the fix for all of a scope's state is one `state` object.
		const groups = new Map<Scope, StateGroup>();
		const isCapturedDeclarator = (declarator: ESTree.Node) => {
			const variables = sourceCode.getDeclaredVariables(declarator);
			return variables.length > 0 && variables.every(isCapturedState);
		};
		// Writes to a grouped binding are covered by the group report.
		const isGrouped = (variable: Variable) =>
			variable.defs.every((definition) => definition.type === "Variable" && isCapturedDeclarator(definition.node));

		const reportAssignment = (node: ESTree.Node, variable: Variable | null) => {
			if (variable !== null && isCapturedState(variable)) {
				if (!isGrouped(variable)) {
					context.report({ node, messageId: "capturedState", data: { names: variable.name } });
				}
				return;
			}
			context.report({ node, messageId: "reassignment" });
		};

		return {
			VariableDeclaration(node) {
				if (node.kind !== "let" && node.kind !== "var") return;
				for (const declarator of node.declarations) {
					const [first] = sourceCode.getDeclaredVariables(declarator);
					if (first === undefined || !isCapturedDeclarator(declarator)) {
						context.report({ node: declarator, messageId: "mutableDeclaration", data: { kind: node.kind } });
						continue;
					}
					const home = first.scope.variableScope;
					const names = sourceCode.getDeclaredVariables(declarator).map((variable) => variable.name);
					const group = groups.get(home);
					if (group === undefined) groups.set(home, { node: declarator, names });
					else group.names.push(...names);
				}
			},
			"Program:exit"() {
				for (const group of groups.values()) {
					context.report({ node: group.node, messageId: "capturedState", data: { names: group.names.join("`, `") } });
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
