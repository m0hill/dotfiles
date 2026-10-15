import { eslintCompatPlugin } from "@oxlint/plugins";

import { noAmbientCapabilitiesRule } from "./rules/no-ambient-capabilities.ts";
import { noClassesRule } from "./rules/no-classes.ts";
import { noEnumsRule } from "./rules/no-enums.ts";
import { noLoopsRule } from "./rules/no-loops.ts";
import { noMutableBindingsRule } from "./rules/no-mutable-bindings.ts";
import { noNullRule } from "./rules/no-null.ts";
import { noSharedMutationRule } from "./rules/no-shared-mutation.ts";
import { noThrowRule } from "./rules/no-throw.ts";
import { noTryCatchRule } from "./rules/no-try-catch.ts";

/** Opt-in Oxlint rules that restrict TypeScript to a small, Gleam-like dialect. */
const antiSlopGleamPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop-gleam" },
	rules: {
		"no-ambient-capabilities": noAmbientCapabilitiesRule,
		"no-classes": noClassesRule,
		"no-enums": noEnumsRule,
		"no-loops": noLoopsRule,
		"no-mutable-bindings": noMutableBindingsRule,
		"no-null": noNullRule,
		"no-shared-mutation": noSharedMutationRule,
		"no-throw": noThrowRule,
		"no-try-catch": noTryCatchRule,
	},
});

export default antiSlopGleamPlugin;
