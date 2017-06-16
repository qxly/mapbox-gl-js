'use strict';

require('flow-remove-types/register');
const util = require('../src/util/util');
const expressionSuite = require('./integration').expression;
const compileExpression = require('../src/style-spec/function/expression');

let tests;

if (process.argv[1] === __filename && process.argv.length > 2) {
    tests = process.argv.slice(2);
}

expressionSuite.run('js', {tests: tests}, (fixture) => {
    const compiled = compileExpression(fixture.expression);

    const testResult = {
        compileResult: util.pick(compiled, ['result', 'isFeatureConstant', 'isZoomConstant', 'errors'])
    };
    if (compiled.result === 'success') testResult.compileResult.type = compiled.type.name;

    if (compiled.result === 'success' && fixture.evaluate) {
        const evaluateResults = [];
        for (const input of fixture.evaluate) {
            try {
                const output = compiled.function.apply(null, input);
                evaluateResults.push(output);
            } catch (error) {
                evaluateResults.push({ error: error.toJSON() });
            }
        }
        if (evaluateResults.length) {
            testResult.evaluateResults = evaluateResults;
        }
    }

    return testResult;
});
