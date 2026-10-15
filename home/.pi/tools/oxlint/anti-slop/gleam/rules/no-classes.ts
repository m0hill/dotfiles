import { defineRule } from "@oxlint/plugins";

import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree } from "@oxlint/plugins";

function isInsideClass(node: ESTree.Node): boolean {
	for (let current = node.parent; current; current = current.parent) {
		if (current.type === "ClassBody") return true;
	}

	return false;
}

function baseName(superClass: ESTree.Expression): string | undefined {
	if (superClass.type === "Identifier") return superClass.name;
	if (superClass.type === "MemberExpression" && !superClass.computed && superClass.property.type === "Identifier") {
		return superClass.property.name;
	}
	return undefined;
}

/** Model data with types and behavior with module functions, as Gleam does. */
export const noClassesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description: "Disallow classes and `this` outside `.ffi.ts` boundary modules.",
		},
		messages: {
			class:
				"Replace this class with a `type` for the data and exported functions that take it as their first argument. Variants become a discriminated union.",
			errorClass:
				"Model expected failures as data, not `Error` subclasses: a union variant such as `{ kind: \"NotFound\", id }` returned in a `Result`, plus a function that describes it when a message is needed.",
			foreignClass:
				"This class extends `{{base}}`, which a platform or library API requires. Move it into a thin `.ffi.ts` or `.ffi.tsx` module whose methods call plain functions.",
			this: "Pass the value as an explicit parameter instead of reading `this`.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};

		const reportClass = (node: ESTree.Class) => {
			const base = node.superClass === null ? undefined : baseName(node.superClass);
			if (node.superClass === null) context.report({ node, messageId: "class" });
			else if (base !== undefined && base.endsWith("Error")) context.report({ node, messageId: "errorClass" });
			else context.report({ node, messageId: "foreignClass", data: { base: base ?? "another class" } });
		};

		return {
			ClassDeclaration: reportClass,
			ClassExpression: reportClass,
			ThisExpression(node) {
				if (!isInsideClass(node)) context.report({ node, messageId: "this" });
			},
		};
	},
});
