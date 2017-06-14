'use strict';

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

module.exports = () => ({
    get: function (obj, key) {
        if (!obj) throw new RuntimeError(`Cannot get property ${key} from null object`);
        if (!(key in obj)) throw new RuntimeError(`Property ${key} not found in object with keys: [${Object.keys(obj)}]`);
        return obj[key];
    },

    asArray: function (arr) {
        if (Array.isArray(arr)) { return arr; }
        throw new RuntimeError('Expected an array');
    },

    asObject: function (obj) {
        if (obj && typeof obj === 'object') { return obj; }
        throw new RuntimeError('Expected an object');
    },

    titlecase: function (s) {
        return `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`;
    }
});
