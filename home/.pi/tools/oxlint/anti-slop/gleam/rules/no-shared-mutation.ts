import { defineRule } from "@oxlint/plugins";

import { isGlobalIdentifier, resolveVariable } from "../../shared/scope.ts";
import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree } from "@oxlint/plugins";

// Map and Set mutators are excluded: `set`, `add`, and `delete` also name ordinary service methods.
const ARRAY_MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);

function rootIdentifier(expression: ESTree.Expression): ESTree.IdentifierReference | undefined {
	if (expression.type === "Identifier") return expression;
	if (expression.type === "MemberExpression") return rootIdentifier(expression.object);
	if (expression.type === "TSNonNullExpression" || expression.type === "TSAsExpression") {
		return rootIdentifier(expression.expression);
	}
	if (expression.type === "ChainExpression") return rootIdentifier(expression.expression);
	return undefined;
}

function methodName(callee: ESTree.MemberExpression): string | undefined {
	if (!callee.computed && callee.property.type === "Identifier") return callee.property.name;
	return callee.property.type === "Literal" && typeof callee.property.value === "string"
		? callee.property.value
		: undefined;
}

/** Keep mutation local: values received from callers or shared at module scope are never changed in place. */
export const noSharedMutationRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow in-place mutation of parameters, imports, and module-level bindings outside `.ffi.ts` boundary modules.",
		},
		messages: {
			sharedMutation:
				"`{{name}}` is {{owner}}, so mutating it changes a value other code also holds. Return a new value instead (`{ ...value, field }`, `[...items, item]`, `items.toSorted()`), or build a local `const` value and return it.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		const sharedOwner = (identifier: ESTree.IdentifierReference): string | undefined => {
			const variable = resolveVariable(context.sourceCode, identifier);
			const definition = variable?.defs[0];
			if (variable === null || definition === undefined) return undefined;
			if (definition.type === "Parameter") return "a parameter";
			if (definition.type === "ImportBinding") return "an import";
			const scopeType = variable.scope.type;
			return scopeType === "module" || scopeType === "global" ? "a module-level binding" : undefined;
		};

		const check = (node: ESTree.Node, target: ESTree.Expression) => {
			const root = rootIdentifier(target);
			if (root === undefined) return;
			const owner = sharedOwner(root);
			if (owner === undefined) return;
			context.report({ node, messageId: "sharedMutation", data: { name: root.name, owner } });
		};

		return {
			AssignmentExpression(node) {
				if (node.left.type === "MemberExpression") check(node, node.left);
			},
			UpdateExpression(node) {
				if (node.argument.type === "MemberExpression") check(node, node.argument);
			},
			UnaryExpression(node) {
				if (node.operator === "delete") check(node, node.argument);
			},
			CallExpression(node) {
				const callee = node.callee;
				if (callee.type !== "MemberExpression") return;
				const name = methodName(callee);
				if (name !== undefined && ARRAY_MUTATORS.has(name)) {
					check(node, callee.object);
					return;
				}
				const target = node.arguments[0];
				if (
					name === "assign" &&
					target !== undefined &&
					target.type !== "SpreadElement" &&
					isGlobalIdentifier(context.sourceCode, callee.object, "Object")
				) {
					check(node, target);
				}
			},
		};
	},
});
