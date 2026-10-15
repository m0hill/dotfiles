import type { ESTree } from "@oxlint/plugins";

export type VisitorKeys = Readonly<Record<string, readonly string[]>>;

function isNode(value: unknown): value is ESTree.Node {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof value.type === "string"
	);
}

/** Return a node's direct child nodes, in visitor-key order. */
export function childNodes(node: ESTree.Node, visitorKeys: VisitorKeys): readonly ESTree.Node[] {
	// SAFETY: Oxlint's visitor keys identify only ESTree child-node properties.
	const fields = node as unknown as Readonly<Record<string, unknown>>; // oxlint-disable-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- visitor keys index node fields by name
	return (visitorKeys[node.type] ?? []).flatMap((key) => {
		const value = fields[key];
		if (isNode(value)) return [value];
		return Array.isArray(value) ? value.filter(isNode) : [];
	});
}
