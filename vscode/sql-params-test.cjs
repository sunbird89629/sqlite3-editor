// Run with `npm test` in vscode/: checks the named-parameter binding.
const assert = require('assert')
const { paramsBlockAt, parseParams, placeholderNames, bindParams } = require('./.tmp/sql-params.cjs')

const lines = [
    '-- database: local/evaluation',
    '',
    '-- params: run_id = \'run_9d18\', limit = 10',
    'SELECT * FROM runs WHERE id = :run_id LIMIT :limit',
]
assert.strictEqual(paramsBlockAt(lines, 3), "run_id = 'run_9d18', limit = 10")
assert.strictEqual(paramsBlockAt(lines, 1), null)

// Values: strings with escapes, numbers, null and booleans.
const parsed = parseParams("a = 'it''s', b = \"x,y\", c = -1.5, d = 42, e = NULL, f = true")
assert.deepStrictEqual([...parsed.values.entries()], [['a', "it's"], ['b', 'x,y'], ['c', -1.5], ['d', 42], ['e', null], ['f', true]])
assert.deepStrictEqual(parsed.errors, [])
assert.ok(parseParams('a = bare').errors.length === 1)

// Placeholders are found in order and not inside comments or literals.
assert.deepStrictEqual(placeholderNames('SELECT :a, ":b", \':c\', -- :d\n :e /* :f */'), ['a', 'e'])

// Binding replaces in order, repeating a value when the name repeats.
const bound = bindParams('SELECT * FROM runs WHERE id = :run_id OR parent = :run_id LIMIT :limit',
    new Map([['run_id', 'x'], ['limit', 10]]))
assert.strictEqual(bound.sql, 'SELECT * FROM runs WHERE id = ? OR parent = ? LIMIT ?')
assert.deepStrictEqual(bound.params, ['x', 'x', 10])

// Literals and comments are untouched.
const untouched = bindParams("SELECT ':nope', \"a\" FROM t -- :skip\nWHERE a = :a", new Map([['a', 1]]))
assert.strictEqual(untouched.sql, "SELECT ':nope', \"a\" FROM t -- :skip\nWHERE a = ?")

// Errors are explicit rather than sending a broken statement.
assert.match(bindParams('SELECT :a', new Map()).error, /Missing a value for :a/)
assert.match(bindParams('SELECT 1', new Map([['a', 1]])).error, /declares "a"/)
assert.match(bindParams('SELECT :a', new Map([['a', 1], ['b', 2]])).error, /never uses it/)

console.log('sql-params: all assertions passed')
