'use strict';
// @flow

const assert = require('assert');

module.exports = compileExpression;

const {
    NullType,
    NumberType,
    StringType,
    BooleanType,
    // ColorType,
    ObjectType,
    ValueType,
    typename,
    variant,
    vector,
    anyArray,
    lambda,
    nargs
} = require('./types');

const typecheck = require('./type_check');
const evaluationContext = require('./evaluation_context');

/*::
 import type { PrimitiveType, TypeName, VariantType, VectorType, ArrayType, AnyArrayType, NArgs, LambdaType, Type } from './types.js';

 import type { ExpressionName, TypeError, TypedLambdaExpression, TypedLiteralExpression, TypedExpression } from './type_check.js';

 type CompileError = {
     error: string,
     key: string
 }

 type CompiledExpression = {|
     result: 'success',
     js: string,
     type: Type,
     isFeatureConstant: boolean,
     isZoomConstant: boolean,
     function?: any
 |}

 type CompileErrors = {|
     result: 'error',
     errors: Array<CompileError>
 |}

 type Definition = {
     name: ExpressionName,
     type: Type,
     compile: (expr: TypedExpression, args: Array<CompiledExpression>) => ({ js: string, errors?: Array<string>, isFeatureConstant?: boolean, isZoomConstant?: boolean })
 }
 */

function defineMathConstant(name) {
    const mathName = name.toUpperCase();
    assert(typeof Math[mathName] === 'number');
    return {
        name: name,
        type: lambda(NumberType),
        compile: () => ({ js: `Math.${mathName}` })
    };
}

function defineMathFunction(name: ExpressionName, arity: number, mathName?: string) {
    const key:string = mathName || name;
    assert(typeof Math[key] === 'function');
    assert(arity > 0);
    const args = [];
    while (arity-- > 0) args.push(NumberType);
    return {
        name: name,
        type: lambda(NumberType, ...args),
        compile: (_, args) => ({ js: `Math.${key}(${args.map(a => a.js).join(', ')})` })
    };
}

function defineBinaryMathOp(name, isAssociative) {
    const args = isAssociative ? [nargs(NumberType)] : [NumberType, NumberType];
    return {
        name: name,
        type: lambda(NumberType, ...args),
        compile: (_, args) => ({ js: `${args.map(a => a.js).join(name)}` })
    };
}

function defineComparisonOp(name, isAssociative) {
    const op = name === '==' ? '===' :
        name === '!=' ? '!==' :
        name;
    const args = isAssociative ? [nargs(typename('T'))] : [typename('T'), typename('T')];

    return {
        name: name,
        type: lambda(BooleanType, ...args),
        compile: (_, args) => ({ js: `${args[0].js} ${op} ${args[1].js}` })
    };
}

function defineBooleanOp(op) {
    return {
        name: op,
        type: lambda(BooleanType, nargs(BooleanType)),
        compile: (_, args) => ({ js: `${args.map(a => a.js).join(op)}` })
    };
}

// function functionWrapper(body) {
//     return (_, args) => {
//         const argnames = args.map((a, i) => `a${i}`).join(', ');
//         const argvalues = args.map(a => a.js).join(', ');
//         return { js: `(function (${argnames}) { ${body} })(${argvalues});` };
//     };
// }

function fromContext(name) {
    return (_, args) => {
        const argvalues = args.map(a => a.js).join(', ');
        return { js: `this.${name}(${argvalues})` };
    };
}

const expressions: { [string]: Definition } = module.exports.expressions = {
    'ln2': defineMathConstant('ln2'),
    'pi': defineMathConstant('pi'),
    'e': defineMathConstant('e'),
    'string': {
        name: 'string',
        type: lambda(StringType, ValueType),
        compile: (_, args) => ({ js: `String(${args[0].js})` })
    },
    'number': {
        name: 'string',
        type: lambda(NumberType, ValueType),
        compile: (_, args) => ({js: `Number(${args[0].js})`})
    },
    'boolean': {
        name: 'boolean',
        type: lambda(BooleanType, ValueType),
        compile: (_, args) => ({js: `Boolean(${args[0].js})`})
    },
    'json_array': {
        name: 'json_array',
        type: lambda(vector(ValueType), ValueType),
        compile: fromContext('asArray')
    },
    'object': {
        name: 'object',
        type: lambda(ObjectType, ValueType),
        compile: fromContext('asObject')
    },
    'get': {
        name: 'get',
        type: lambda(ValueType, ObjectType, StringType),
        compile: fromContext('get')
    },
    'has': {
        name: 'has',
        type: lambda(BooleanType, ObjectType, StringType),
        compile: (_, args) => ({js: `${args[0].js}.hasOwnProperty(${args[1].js})`})
    },
    'at': {
        name: 'at',
        type: lambda(
            typename('T'),
            variant(vector(typename('T')), anyArray(typename('T'))),
            NumberType
        ),
        compile: (_, args) => ({js: `${args[0].js}[${args[1].js}]`})
    },
    'typeof': {
        name: 'typeof',
        type: lambda(StringType, ValueType),
        compile: (_, args) => ({
            js: `
            Array.isArray(${args[0].js}) ? 'Vector<Value>' :
            ${args[0].js} === null ? 'Null' :
            this.titlecase(typeof ${args[0].js})`
        })
    },
    'length': {
        name: 'length',
        type: lambda(NumberType, variant(
            vector(typename('T')),
            StringType
        )),
        compile: (_, args) => ({js: `${args[0].js}.length`})
    },
    'properties': {
        name: 'properties',
        type: lambda(ObjectType),
        compile: () => ({
            js: 'this.asObject(props)',
            isFeatureConstant: false
        })
    },
    'geometry_type': {
        name: 'geometry_type',
        type: lambda(StringType),
        // TODO: should yield error if missing
        compile: () => ({
            js: '(feature.geometry || {}).type || null',
            isFeatureConstant: false
        })
    },
    'id': {
        name: 'id',
        type: lambda(ValueType),
        // TODO: should yield error if missing
        compile: () => ({
            js: 'typeof feature.id === "undefined" ? null : feature.id',
            isFeatureConstant: false
        })
    },
    'zoom': {
        name: 'zoom',
        type: lambda(NumberType),
        compile: () => ({js: 'mapProperties.zoom', isZoomConstant: false})
    },
    '+': defineBinaryMathOp('+'),
    '*': defineBinaryMathOp('*'),
    '-': defineBinaryMathOp('-'),
    '/': defineBinaryMathOp('/'),
    '%': defineBinaryMathOp('%'),
    '^': {
        name: '^',
        type: lambda(NumberType, NumberType, NumberType),
        compile: (_, args) => ({js: `Math.pow(${args[0].js}, ${args[1].js})`})
    },
    'log10': defineMathFunction('log10', 1),
    'ln': defineMathFunction('ln', 1, 'log'),
    'log2': defineMathFunction('log2', 1),
    'sin': defineMathFunction('sin', 1),
    'cos': defineMathFunction('cos', 1),
    'tan': defineMathFunction('tan', 1),
    'asin': defineMathFunction('asin', 1),
    'acos': defineMathFunction('acos', 1),
    'atan': defineMathFunction('atan', 1),
    '==': defineComparisonOp('=='),
    '!=': defineComparisonOp('!='),
    '>': defineComparisonOp('>'),
    '<': defineComparisonOp('<'),
    '>=': defineComparisonOp('>='),
    '<=': defineComparisonOp('<='),
    '&&': defineBooleanOp('&&'),
    '||': defineBooleanOp('||'),
    '!': {
        name: '!',
        type: lambda(BooleanType, BooleanType),
        compile: (_, args) => ({js: `!(${args[0].js})`})
    },
    'upcase': {
        name: 'upcase',
        type: lambda(StringType, StringType),
        compile: (_, args) => ({js: `(${args[0].js}).toUpperCase()`})
    },
    'downcase': {
        name: 'downcase',
        type: lambda(StringType, StringType),
        compile: (_, args) => ({js: `(${args[0].js}).toLowerCase()`})
    },
    'concat': {
        name: 'concat',
        type: lambda(StringType, nargs(ValueType)),
        compile: (_, args) => ({js: `[${args.map(a => a.js).join(', ')}].join('')`})
    },
    'case': {
        name: 'case',
        type: lambda(typename('T'), nargs(BooleanType, typename('T')), typename('T')),
        compile: (_, args) => {
            args = [].concat(args);
            const result = [];
            while (args.length > 1) {
                const c = args.splice(0, 2);
                result.push(`${c[0].js} ? ${c[1].js}`);
            }
            assert(args.length === 1); // enforced by type checking
            result.push(args[0].js);
            return { js: result.join(':') };
        }
    }
};


/**
 *
 * Given a style function expression object, returns:
 * ```
 * {
 *   result: 'success',
 *   isFeatureConstant: boolean,
 *   isZoomConstant: boolean,
 *   js: string,
 *   function: Function
 * }
 * ```
 * or else
 *
 * ```
 * {
 *   result: 'error',
 *   errors: Array<CompileError>
 * }
 * ```
 *
 * @private
 */
function compileExpression(expr: any) {
    const parsed = parseExpression('', expr);
    const compiled = compile(null, parsed);
    if (compiled.result === 'success') {
        const fn = new Function('mapProperties', 'feature', `
mapProperties = mapProperties || {};
feature = feature || {};
var props = feature.properties || {};
return (${compiled.js})
`);
        compiled.function = fn.bind(evaluationContext());
    }

    return compiled;
}

function compile(expected: Type | null, e: TypedExpression) /*: CompiledExpression | CompileErrors */ {

    const typecheckResult = typecheck(expected || e.type, e);
    if (typecheckResult.errors) {
        return { result: 'error', errors: typecheckResult.errors };
    } else {
        e = typecheckResult;
    }

    if (e.literal) {
        return {
            result: 'success',
            js: JSON.stringify(e.value),
            type: e.type,
            isFeatureConstant: true,
            isZoomConstant: true
        };
    } else {
        const errors: Array<CompileError> = [];
        const compiledArgs: Array<CompiledExpression> = [];

        for (let i = 0; i < e.arguments.length; i++) {
            const arg = e.arguments[i];
            const argType = e.type.args[i];
            const compiledArg = compile(argType, arg);
            if (compiledArg.result === 'error') {
                errors.push.apply(errors, compiledArg.errors);
            } else if (compiledArg.result === 'success') {
                compiledArgs.push(compiledArg);
            }
        }

        if (errors.length > 0) {
            return { result: 'error', errors };
        }

        let isFeatureConstant = compiledArgs.reduce((memo, arg) => memo && arg.isFeatureConstant, true);
        let isZoomConstant = compiledArgs.reduce((memo, arg) => memo && arg.isZoomConstant, true);

        const definition = expressions[e.name];
        const compiled = definition.compile(e, compiledArgs);
        if (compiled.errors) {
            return {
                result: 'error',
                errors: compiled.errors.map(message => ({ error: message, key: e.key }))
            };
        }

        if (typeof compiled.isFeatureConstant === 'boolean') {
            isFeatureConstant = isFeatureConstant && compiled.isFeatureConstant;
        }
        if (typeof compiled.isZoomConstant === 'boolean') {
            isZoomConstant = isZoomConstant && compiled.isZoomConstant;
        }

        return {
            result: 'success',
            js: `(${compiled.js})`,
            type: e.type.result,
            isFeatureConstant,
            isZoomConstant
        };
    }
}

/**
 * Parse raw JSON expression into a TypedExpression structure, with type
 * tags taken directly from the definition of each function (i.e.,
 * no inference performed).
 *
 * @private
 */
function parseExpression(key: string, expr: any) /*: TypedExpression */ {
    if (typeof expr === 'undefined') return {
        literal: true,
        value: null,
        type: NullType,
        key
    };

    if (typeof expr === 'string') return {
        literal: true,
        value: expr,
        type: StringType,
        key
    };

    if (typeof expr === 'number') return {
        literal: true,
        value: expr,
        type: NumberType,
        key
    };

    if (typeof expr === 'boolean') return {
        literal: true,
        value: expr,
        type: BooleanType,
        key
    };

    if (!Array.isArray(expr)) {
        throw new Error(`${key}: expected an array, but found ${typeof expr} instead.`);
    }

    const op = expr[0];
    const definition = expressions[op];
    if (!definition) {
        throw new Error(`${key}: unknown function ${op}`);
    }

    return {
        literal: false,
        name: op,
        type: definition.type,
        arguments: expr.slice(1).map((arg, i) => parseExpression(`${key}.${i + 1}`, arg)),
        key
    };
}

