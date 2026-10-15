import { defineRule } from "@oxlint/plugins";

import { isGlobalIdentifier } from "../../shared/scope.ts";
import { isBoundaryFile } from "../shared/boundary.ts";

import type { ESTree } from "@oxlint/plugins";

const GLOBAL_CAPABILITIES = new Map([
	["fetch", "the network"],
	["WebSocket", "the network"],
	["XMLHttpRequest", "the network"],
	["EventSource", "the network"],
	["setTimeout", "timers"],
	["setInterval", "timers"],
	["setImmediate", "timers"],
	["process", "the process environment"],
]);

const MEMBER_CAPABILITIES = new Map([
	["Date.now", "the clock"],
	["performance.now", "the clock"],
	["Math.random", "randomness"],
	["crypto.randomUUID", "randomness"],
	["crypto.getRandomValues", "randomness"],
]);

const IO_MODULES = new Set([
	"child_process",
	"dgram",
	"dns",
	"fs",
	"fs/promises",
	"http",
	"http2",
	"https",
	"net",
	"tls",
]);

/** Return whether an identifier is read as a value, rather than named as a key, property, or type. */
function isValueReference(node: ESTree.Node): node is ESTree.IdentifierReference {
	const parent = node.parent;
	if (parent === null) return false;
	if (parent.type === "CallExpression" || parent.type === "NewExpression") {
		return parent.callee === node || parent.arguments.some((argument) => argument === node);
	}
	if (parent.type === "MemberExpression") return parent.object === node;
	if (parent.type === "Property") return parent.value === node;
	if (parent.type === "VariableDeclarator") return parent.init === node;
	if (parent.type === "AssignmentExpression") return parent.right === node;
	if (parent.type === "ReturnStatement" || parent.type === "SpreadElement") return parent.argument === node;
	if (parent.type === "ArrowFunctionExpression") return parent.body === node;
	return parent.type === "ArrayExpression" && parent.elements.some((element) => element === node);
}

function ioModuleName(source: string): string | undefined {
	const name = source.startsWith("node:") ? source.slice("node:".length) : source;
	return IO_MODULES.has(name) ? name : undefined;
}

/** Pass clocks, randomness, timers, network, environment, and file access in as parameters, as Effect services do. */
export const noAmbientCapabilitiesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow direct use of the clock, randomness, timers, network, process environment, and I/O modules outside `.ffi.ts` boundary modules.",
		},
		messages: {
			ambient:
				"`{{name}}` reads {{capability}} directly, so callers and tests cannot control it. Take it as a parameter (for example `now: () => Date`, `fetch: typeof fetch`, `sleep: (ms: number) => Promise<void>`) and pass the real one in from a `.ffi.ts` module, such as the program's entry point.",
		},
	},
	create(context) {
		if (isBoundaryFile(context.filename)) return {};
		const { sourceCode } = context;

		const reportModule = (node: ESTree.Node, source: ESTree.Node) => {
			if (source.type !== "Literal" || typeof source.value !== "string") return;
			const name = ioModuleName(source.value);
			if (name === undefined) return;
			context.report({ node, messageId: "ambient", data: { name: source.value, capability: `the ${name} module` } });
		};

		return {
			Identifier(node) {
				const capability = GLOBAL_CAPABILITIES.get(node.name);
				if (capability === undefined || !isValueReference(node)) return;
				if (!isGlobalIdentifier(sourceCode, node, node.name)) return;
				context.report({ node, messageId: "ambient", data: { name: node.name, capability } });
			},
			MemberExpression(node) {
				if (node.computed || node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
				const name = `${node.object.name}.${node.property.name}`;
				const capability = MEMBER_CAPABILITIES.get(name);
				if (capability === undefined) return;
				if (!isGlobalIdentifier(sourceCode, node.object, node.object.name)) return;
				context.report({ node, messageId: "ambient", data: { name, capability } });
			},
			NewExpression(node) {
				if (node.arguments.length > 0 || !isGlobalIdentifier(sourceCode, node.callee, "Date")) return;
				context.report({ node, messageId: "ambient", data: { name: "new Date()", capability: "the clock" } });
			},
			CallExpression(node) {
				if (isGlobalIdentifier(sourceCode, node.callee, "Date")) {
					context.report({ node, messageId: "ambient", data: { name: "Date()", capability: "the clock" } });
					return;
				}
				const [source] = node.arguments;
				if (source !== undefined && isGlobalIdentifier(sourceCode, node.callee, "require")) {
					reportModule(node, source);
				}
			},
			ImportDeclaration(node) {
				if (node.importKind === "type") return;
				reportModule(node, node.source);
			},
			ImportExpression(node) {
				reportModule(node, node.source);
			},
		};
	},
});
