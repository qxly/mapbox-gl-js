'use strict';
// @flow

/*::
 import type { PrimitiveType, TypeName, VariantType, VectorType, ArrayType, AnyArrayType, NArgs, LambdaType, Type } from './types.js';

 export type TypeError = {
     error: string,
     key: string
 }

 export type ExpressionName = "literal" | "ln2" | "pi" | "e" | "string" | "number" | "boolean" | "json_array" | "object" | "get" | "has" | "at" | "typeof" | "length" | "zoom" | "properties" | "geometry_type" | "id" | "case" | "match" | "is_error" | "==" | "!=" | ">" | ">=" | "<=" | "<" | "&&" | "||" | "!" | "curve" | "step" | "exponential" | "linear" | "cubic-bezier" | "+" | "-" | "*" | "/" | "%" | "^" | "log10" | "ln" | "log2" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "ceil" | "floor" | "round" | "abs" | "min" | "max" | "concat" | "upcase" | "downcase" | "rgb" | "rgba" | "color" | "color_to_array"

 export type TypedLambdaExpression = {|
     literal: false,
     name: ExpressionName,
     type: LambdaType,
     arguments: Array<TypedExpression>,
     key: string
 |}

 export type TypedLiteralExpression = {|
     literal: true,
     value: string | number | boolean | null,
     type: Type,
     key: string
 |}

 export type TypedExpression = TypedLambdaExpression | TypedLiteralExpression

 */

const util = require('../../util/util');

const { lambda, } = require('./types');

module.exports = typeCheckExpression;

// typecheck the given expression and resolve generics
function typeCheckExpression(expected: Type, e: TypedExpression) /*: TypedExpression | {| errors: Array<TypeError> |} */ {
    if (e.literal) {
        const error = matchTypeError(expected, e.type);
        if (error) return { errors: [{ key: e.key, error }] };
        return e;
    } else {
        const typenameMap = {};

        const expectedResult = expected.kind === 'lambda' ? expected.result : expected;
        const expectedArgs = expected.kind === 'lambda' ? expected.args : e.type.args;

        if (expectedResult.kind === 'typename') return {
            errors: [{key: e.key, error: `Could not resolve ${expectedResult.name}.  This expression must be wrapped in a type conversion, e.g. ["string", ${stringifyExpression(e)}].`}]
        };

        const error = matchTypeError(expectedResult, e.type.result, typenameMap);
        if (error) return { errors: [{ key: e.key, error }] };

        // unroll NArgs, and collect typename mappings & type errors
        const argValues = e.arguments;
        const expandedArgTypes = [];
        const errors = [];
        for (let vi = 0, ti = 0; vi < argValues.length && ti < expectedArgs.length; ti++) {
            const t = expectedArgs[ti];
            if (t.kind === 'nargs') {
                // greedily 'consume' subsequences of argument values that match
                // the type list for this NArgs type
                let j = 0;
                let curTypeNames = {};
                while (vi < argValues.length && !matchTypeError(t.types[j], argValues[vi].type, curTypeNames)) {
                    vi++;
                    j = (j + 1) % t.types.length;
                    // If we've consumed a full sequence, append a copy of this
                    // list of types to the expanded argument list
                    if (j === 0) {
                        expandedArgTypes.push.apply(expandedArgTypes, t.types);
                        util.extend(typenameMap, curTypeNames);
                        curTypeNames = {};
                    }
                }
                vi -= j;
            } else {
                const error = matchTypeError(t, argValues[vi].type, typenameMap);
                if (error) errors.push({ key: e.key, error });
                expandedArgTypes.push(t);
                vi++;
            }
        }

        if (expandedArgTypes.length !== argValues.length) {
            errors.push({
                key: e.key,
                error: `Expected ${expandedArgTypes.length} arguments, but found ${argValues.length} instead.`
            });
        }

        // If we already have errors, return early so we don't get duplicates when
        // we typecheck against the expanded/resolved argument types
        if (errors.length) return { errors };

        // resolve typenames and recursively type check argument expressions
        const resolvedArgTypes = [];
        const checkedArgs = [];
        for (let i = 0; i < expandedArgTypes.length; i++) {
            const t = expandedArgTypes[i];
            const arg = argValues[i];
            const expected = (t.kind === 'typename' && typenameMap[t.typename]) ? typenameMap[t.typename] : t;

            const result = typeCheckExpression(expected, arg);
            if (result.errors) {
                errors.push.apply(errors, result.errors);
            } else if (errors.length === 0) {
                resolvedArgTypes.push(expected);
                checkedArgs.push(result);
            }
        }

        if (errors.length > 0) return { errors };

        return {
            literal: false,
            name: e.name,
            type: lambda(expectedResult, ...resolvedArgTypes),
            arguments: checkedArgs,
            key: e.key
        };
    }

}

// returns null if the type matches, or an error message if not
function matchTypeError(expected: Type, t: Type, typenameMap?: { [string]: Type }) {
    const errorMessage = `Expected ${expected.name} but found ${t.name} instead.`;

    if (t.kind === 'lambda') t = t.result;

    if (typenameMap) {
        if (expected.kind === 'typename') {
            if (!typenameMap[expected.typename] && !isGeneric(t)) {
                typenameMap[expected.typename] = t;
            }
            return null;
        }

        if (t.kind === 'typename') {
            if (typenameMap[t.typename]) {
                t = typenameMap[t.typename];
            } else if (!isGeneric(expected)) {
                t = typenameMap[t.typename] = expected;
            }
        }
    }

    if (expected.kind === 'primitive') {
        if (t === expected) return null;
        else return errorMessage;
    } else if (expected.kind === 'vector') {
        if (t.kind === 'vector') {
            const error = matchTypeError(expected.itemType, t.itemType, typenameMap);
            if (error) return `${errorMessage}. (${error})`;
            else return null;
        } else {
            return errorMessage;
        }
    } else if (expected.kind === 'any_array' || expected.kind === 'array') {
        if (t.kind === 'array') {
            const error = matchTypeError(expected.itemType, t.itemType, typenameMap);
            if (error) return `${errorMessage}. (${error})`;
            else if (expected.kind === 'array' && expected.N !== t.N) return errorMessage;
            else return null;
        } else {
            // technically we should check if t is a variant all of whose
            // members are Arrays, but it's probably not necessary in practice.
            return errorMessage;
        }
    } else if (expected.kind === 'variant') {
        if (t === expected) return null;

        for (const memberType of expected.members) {
            const memberTypeNames = typenameMap && util.extend({}, typenameMap);
            const error = matchTypeError(memberType, t, memberTypeNames);
            if (!error) {
                if (typenameMap && memberTypeNames) util.extend(typenameMap, memberTypeNames);
                return null;
            }
        }

        // If t itself is a variant, then 'expected' must match each of its
        // member types in order for this to be a match.
        if (t.kind === 'variant') return t.members.some(m => matchTypeError(expected, m)) ? errorMessage : null;

        return errorMessage;
    }

    throw new Error(`${expected.name} is not a valid output type.`);
}

function serializeExpression(e: TypedExpression) {
    if (e.literal) {
        return e.value;
    } else {
        return [ e.name ].concat(e.arguments.map(serializeExpression));
    }
}
function stringifyExpression(e: TypedExpression) /*:string*/ {
    return JSON.stringify(serializeExpression(e));
}

function isGeneric (type, stack = []) {
    if (stack.indexOf(type) >= 0) { return false; }
    if (type.kind === 'typename') {
        return true;
    } else if (type.kind === 'vector' || type.kind === 'array') {
        return isGeneric(type.itemType, stack.concat(type));
    } else if (type.kind === 'variant') {
        return type.members.some((t) => isGeneric(t, stack.concat(type)));
    }
    return false;
}

