import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/** Resolve an identifier to its binding by walking lexical scopes upward. */
export function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

/** Reports whether an expression names an unshadowed global binding. */
export function isGlobalIdentifier(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	name: string,
): expression is ESTree.IdentifierReference {
	if (expression.type !== "Identifier" || expression.name !== name) return false;
	if (sourceCode.isGlobalReference(expression)) return true;
	const variable = resolveVariable(sourceCode, expression);
	return variable === null || variable.defs.length === 0;
}
