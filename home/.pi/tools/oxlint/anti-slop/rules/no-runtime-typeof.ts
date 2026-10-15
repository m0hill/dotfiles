import { defineRule } from "@oxlint/plugins";

import { isGlobalIdentifier } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const PRIMITIVE_WRAPPERS = ["String", "Number", "Boolean", "BigInt", "Object"];
const EQUALITY_OPERATORS = ["===", "!==", "==", "!="];

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	);
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			return current.returnType?.typeAnnotation.type === "TSTypePredicate";
		}
		current = current.parent;
	}
	return false;
}

/** Return whether typeof safely probes for the existence of a possibly absent binding. */
function isExistenceProbe(node: ESTree.UnaryExpression): boolean {
	const parent = node.parent;
	if (parent.type !== "BinaryExpression") return false;
	if (!["===", "!==", "==", "!="].includes(parent.operator)) return false;
	const other = parent.left === node ? parent.right : parent.left;
	return other.type === "Literal" && other.value === "undefined";
}

/** Return whether a comparison such as `String(value) === value` re-implements a typeof check. */
function isWrapperRoundTrip(sourceCode: SourceCode, node: ESTree.BinaryExpression): boolean {
	if (!EQUALITY_OPERATORS.includes(node.operator)) return false;
	return [
		[node.left, node.right],
		[node.right, node.left],
	].some(([call, other]) => {
		if (call?.type !== "CallExpression" || call.arguments.length !== 1) return false;
		if (!PRIMITIVE_WRAPPERS.some((name) => isGlobalIdentifier(sourceCode, call.callee, name))) return false;
		const argument = call.arguments[0];
		return argument !== undefined && other !== undefined && sourceCode.getText(argument) === sourceCode.getText(other);
	});
}

/** Return whether an instanceof check against the global Object re-implements `typeof value === "object"`. */
function isObjectInstanceCheck(sourceCode: SourceCode, node: ESTree.BinaryExpression): boolean {
	return node.operator === "instanceof" && isGlobalIdentifier(sourceCode, node.right, "Object");
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary with the project's schema library (add Zod if there is none), for example `RuleSchema.safeParse(JSON.parse(text))`, then branch on the domain value.",
			typeofEquivalent:
				"This comparison is a `typeof` check in disguise. Do not rewrite `typeof`; parse input at its I/O boundary with the project's schema library (add Zod if there is none), then branch on the domain value.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInTypeGuards: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		const allowsTypeGuards = (): boolean => {
			const option = context.options[0];
			return (
				typeof option === "object" &&
				option !== null &&
				!Array.isArray(option) &&
				option.allowInTypeGuards === true
			);
		};

		return {
			UnaryExpression(node) {
				if (
					node.operator === "typeof" &&
					!isExistenceProbe(node) &&
					(!allowsTypeGuards() || !isInsideTypeGuard(node))
				) {
					context.report({ node, messageId: "runtimeTypeof" });
				}
			},
			BinaryExpression(node) {
				const disguised =
					isWrapperRoundTrip(context.sourceCode, node) || isObjectInstanceCheck(context.sourceCode, node);
				if (disguised && (!allowsTypeGuards() || !isInsideTypeGuard(node))) {
					context.report({ node, messageId: "typeofEquivalent" });
				}
			},
		};
	},
});
