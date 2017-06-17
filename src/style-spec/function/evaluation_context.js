'use strict';

const parseColor = require('../util/parse_color');

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
            input[0] = input[0] / 255;
            input[1] = input[1] / 255;
            input[2] = input[2] / 255;
            if (input.length === 3) { input.push(1); }
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
        return new Color(components);
    }

});

function titlecase (s) {
    return `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`;
}
