import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  containsUnknownType,
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";

const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required"]);

function propertyName(key: ESTree.PropertyKey): string | undefined {
  if (key.type === "Identifier") return key.name;
  return key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
}

/** Return whether an object parameter hides an unknown member, other than `cause`, from the top-level check. */
function wrapsUnknownType(type: ESTree.TSType): boolean {
  if (type.type === "TSParenthesizedType") return wrapsUnknownType(type.typeAnnotation);
  if (type.type === "TSUnionType" || type.type === "TSIntersectionType") return type.types.some(wrapsUnknownType);
  if (type.type === "TSTypeReference") {
    return (
      type.typeName.type === "Identifier" &&
      TRANSPARENT_WRAPPERS.has(type.typeName.name) &&
      (type.typeArguments?.params.some(wrapsUnknownType) ?? false)
    );
  }
  if (type.type !== "TSTypeLiteral") return false;
  return type.members.some((member) => {
    if (member.type !== "TSPropertySignature" || member.typeAnnotation == null) return false;
    if (propertyName(member.key) === "cause") return false;
    const memberType = member.typeAnnotation.typeAnnotation;
    return containsUnknownType(memberType) || wrapsUnknownType(memberType);
  });
}

type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function isTypePredicateSubject(owner: ParameterOwner, parameterName: string): boolean {
  const predicate = owner.returnType?.typeAnnotation;
  return (
    predicate?.type === "TSTypePredicate" &&
    predicate.parameterName.type === "Identifier" &&
    predicate.parameterName.name === parameterName
  );
}

/** Return the argument index that receives a rejection reason for `.catch(fn)` and `.then(ok, fn)`. */
function rejectionHandlerIndex(callee: ESTree.Expression | ESTree.Super): number | undefined {
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return undefined;
  if (callee.property.name === "catch") return 0;
  return callee.property.name === "then" ? 1 : undefined;
}

/** Return whether a parameter receives a promise rejection reason, which has no earlier boundary to parse it at. */
function isRejectionReason(owner: ParameterOwner, parameterIndex: number): boolean {
  if (parameterIndex !== 0) return false;
  if (owner.type !== "ArrowFunctionExpression" && owner.type !== "FunctionExpression") return false;
  const call = owner.parent;
  if (call.type !== "CallExpression") return false;
  const index = rejectionHandlerIndex(call.callee);
  return index !== undefined && call.arguments[index] === owner;
}

/** Disallow unknown inputs except error causes, promise rejection reasons, and type-predicate subjects. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters, including unknown members of object parameters, except `cause`, promise rejection reasons, and type-predicate subjects; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; parse at the I/O boundary with the project's schema library (add Zod if there is none) before calling this function.",
    },
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      for (const [index, parameter] of node.params.entries()) {
        const annotation = functionParameterTypeAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        if (isRejectionReason(node, index)) continue;
        const type = annotation.typeAnnotation;
        if (!containsUnknownType(type) && !wrapsUnknownType(type)) continue;
        const name = functionParameterBindingName(parameter, context.sourceCode);
        if (name === "cause" || isTypePredicateSubject(node, name)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
