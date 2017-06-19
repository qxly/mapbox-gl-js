'use strict';

const parseColor = require('../util/parse_color');
const interpolate = require('../util/interpolate');

class RuntimeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ExpressionEvaluationError';
        this.message = message;
    }

    toJSON() {
        return `${this.name}: ${this.message}`;
    }
}

class Color {
    constructor(input) {
        if (Array.isArray(input)) {
            this.value = input;
        } else {
            this.value = parseColor(input);
            if (typeof this.value === 'undefined') throw new RuntimeError(`Could not parse color from value '${input}'`);
        }
    }
}

module.exports = () => ({
    get: function (obj, key) {
        if (!obj) throw new RuntimeError(`Cannot get property ${key} from null object`);
        if (!(key in obj)) throw new RuntimeError(`Property ${key} not found in object with keys: [${Object.keys(obj)}]`);
        return obj[key];
    },

    typeOf: function (x) {
        if (Array.isArray(x)) return 'Vector<Value>';
        else if (x === null) return 'Null';
        else if (x instanceof Color) return 'Color';
        else return titlecase(typeof x);
    },

    asArray: function (arr) {
        if (Array.isArray(arr)) { return arr; }
        throw new RuntimeError('Expected an array');
    },

    asObject: function (obj) {
        if (obj && typeof obj === 'object') { return obj; }
        throw new RuntimeError('Expected an object');
    },

    color: function (s) {
        return new Color(s);
    },

    rgba: function (...components) {
        return new Color([
            components[0] / 255,
            components[1] / 255,
            components[2] / 255,
            components.length > 3 ? components[3] : 1
        ]);
    },

    evaluateCurve(input, stopInputs, stopOutputs, interpolation, resultType) {
        const stopCount = stopInputs.length;
        if (input <= stopInputs[0]) return stopOutputs[0]();
        if (input >= stopInputs[stopCount - 1]) return stopOutputs[stopCount - 1]();

        const index = findStopLessThanOrEqualTo(stopInputs, input);

        if (interpolation.name === 'step') {
            return stopOutputs[index]();
        }

        let base = 1;
        if (interpolation.name === 'exponential') {
            base = interpolation.base;
        }
        const t = interpolationFactor(input, base, stopInputs[index], stopInputs[index + 1]);

        return resultType === 'color' ?
            new Color(interpolate.color(stopOutputs[index]().value, stopOutputs[index + 1]().value, t)) :
            interpolate[resultType](stopOutputs[index](), stopOutputs[index + 1](), t);
    },

});

function titlecase (s) {
    return `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`;
}

/**
 * Returns the index of the last stop <= input, or 0 if it doesn't exist.
 *
 * @private
 */
function findStopLessThanOrEqualTo(stops, input) {
    const n = stops.length;
    let lowerIndex = 0;
    let upperIndex = n - 1;
    let currentIndex = 0;
    let currentValue, upperValue;

    while (lowerIndex <= upperIndex) {
        currentIndex = Math.floor((lowerIndex + upperIndex) / 2);
        currentValue = stops[currentIndex];
        upperValue = stops[currentIndex + 1];
        if (input === currentValue || input > currentValue && input < upperValue) { // Search complete
            return currentIndex;
        } else if (currentValue < input) {
            lowerIndex = currentIndex + 1;
        } else if (currentValue > input) {
            upperIndex = currentIndex - 1;
        }
    }

    return Math.max(currentIndex - 1, 0);
}

/**
 * Returns a ratio that can be used to interpolate between exponential function
 * stops.
 *
 * How it works:
 * Two consecutive stop values define a (scaled and shifted) exponential
 * function `f(x) = a * base^x + b`, where `base` is the user-specified base,
 * and `a` and `b` are constants affording sufficient degrees of freedom to fit
 * the function to the given stops.
 *
 * Here's a bit of algebra that lets us compute `f(x)` directly from the stop
 * values without explicitly solving for `a` and `b`:
 *
 * First stop value: `f(x0) = y0 = a * base^x0 + b`
 * Second stop value: `f(x1) = y1 = a * base^x1 + b`
 * => `y1 - y0 = a(base^x1 - base^x0)`
 * => `a = (y1 - y0)/(base^x1 - base^x0)`
 *
 * Desired value: `f(x) = y = a * base^x + b`
 * => `f(x) = y0 + a * (base^x - base^x0)`
 *
 * From the above, we can replace the `a` in `a * (base^x - base^x0)` and do a
 * little algebra:
 * ```
 * a * (base^x - base^x0) = (y1 - y0)/(base^x1 - base^x0) * (base^x - base^x0)
 *                     = (y1 - y0) * (base^x - base^x0) / (base^x1 - base^x0)
 * ```
 *
 * If we let `(base^x - base^x0) / (base^x1 base^x0)`, then we have
 * `f(x) = y0 + (y1 - y0) * ratio`.  In other words, `ratio` may be treated as
 * an interpolation factor between the two stops' output values.
 *
 * (Note: a slightly different form for `ratio`,
 * `(base^(x-x0) - 1) / (base^(x1-x0) - 1) `, is equivalent, but requires fewer
 * expensive `Math.pow()` operations.)
 *
 * @private
*/
function interpolationFactor(input, base, lowerValue, upperValue) {
    const difference = upperValue - lowerValue;
    const progress = input - lowerValue;

    if (base === 1) {
        return progress / difference;
    } else {
        return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
    }
}

