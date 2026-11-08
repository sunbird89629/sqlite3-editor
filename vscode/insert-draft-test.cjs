const assert = require('node:assert/strict')
const { test } = require('node:test')
const esbuild = require('esbuild')
const vm = require('node:vm')
const source = esbuild.buildSync({ entryPoints: [require('node:path').join(__dirname, 'insert-draft.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const moduleShim = { exports: {} }
vm.runInThisContext('(function(module,exports,require){' + source + '\n})')(moduleShim, moduleShim.exports, require)
const { buildInsert } = moduleShim.exports
const field = (name, type, value = '', blob = null) => ({ name, type, value, blob })

test('INSERT quotes identifiers and binds all non-default values', () => {
    const draft = { database: '/tmp/test.db', table: 'odd"table', fields: [field('a"b', 'string', "x'); DROP TABLE t;--"), field('big', 'number', '9223372036854775807'), field('n', 'null'), field('b', 'blob', '', [0, 255]), field('skip', 'default')] }
    const result = buildInsert(draft)
    assert.equal(result.query, 'INSERT INTO "odd""table" ("a""b", "big", "n", "b") VALUES (?, ?, ?, ?)')
    assert.deepEqual(result.params, ["x'); DROP TABLE t;--", 9223372036854775807n, null, new Uint8Array([0, 255])])
})

test('default values and invalid numeric input', () => {
    assert.equal(buildInsert({ database: 'db', table: 't', fields: [field('x', 'default')] }).query, 'INSERT INTO "t" DEFAULT VALUES')
    assert.throws(() => buildInsert({ database: 'db', table: 't', fields: [field('x', 'number', 'NaN')] }), /Invalid numeric/)
})
