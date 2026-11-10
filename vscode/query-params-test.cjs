const assert = require('node:assert/strict')
const { test } = require('node:test')
const esbuild = require('esbuild')
const vm = require('node:vm')
const source = esbuild.buildSync({ entryPoints: [require('node:path').join(__dirname, 'query-params.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
const moduleShim = { exports: {} }
vm.runInThisContext('(function(module,exports,require){' + source + '\n})')(moduleShim, moduleShim.exports, require)
const { bindParams, findParamsBlock, mergePlaceholders, paramDiagnostics, parseLiteral } = moduleShim.exports

const placeholder = (name) => ({ name, ranges_relative_to_stmt: [{ start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }] })
const anonymous = () => ({ name: null, ranges_relative_to_stmt: [] })
const labels = (placeholders) => mergePlaceholders(placeholders).map((entry) => entry.label)

test('the comment block directly above a statement supplies the values', () => {
    const lines = ['-- database: /tmp/x.db', '', '-- 说明', '-- params: cid = 1', '-- params: cid = 2', 'SELECT :cid;']
    assert.equal(findParamsBlock(lines, 5, false), ' cid = 2')
    assert.equal(findParamsBlock([], 0, false), null)
})

test('a line of SQL ends the comment block', () => {
    assert.equal(findParamsBlock(['-- params: cid = 1', 'SELECT 1;', 'SELECT :cid;'], 2, false), null)
    assert.equal(findParamsBlock(['-- database: db', '-- params: cid = 1', 'SELECT :cid;'], 2, false), ' cid = 1')
})

test('a CTE entry point uses the nearest earlier definition', () => {
    const lines = ['-- params: threshold = 3', 'WITH recent AS (SELECT * FROM runs WHERE score > :threshold)', 'SELECT * FROM recent;']
    assert.equal(findParamsBlock(lines, 1, true), ' threshold = 3')
})

test('literals map to the SQLite types the transport supports', () => {
    const block = `cid = 'a,b', n = 42, f = 2.5, k = NULL, b = x'00ff'`
    const result = bindParams(block, [placeholder(':cid'), placeholder(':n'), placeholder(':f'), placeholder(':k'), placeholder(':b')])
    assert.ok(!('error' in result), result.error)
    assert.equal(result.params.length, 5)
    assert.equal(result.params[0], 'a,b')
    assert.equal(result.params[1], 42n)
    assert.equal(result.params[2], 2.5)
    assert.equal(result.params[3], null)
    assert.deepEqual(Array.from(result.params[4]), [0, 255])
})

test('quoted quotes and plain strings', () => {
    assert.deepEqual(parseLiteral("'it''s'"), { value: "it's" })
    assert.deepEqual(parseLiteral("'abc'"), { value: 'abc' })
    assert.deepEqual(parseLiteral('42'), { value: 42n })
    assert.deepEqual(parseLiteral('9223372036854775807'), { value: 9223372036854775807n })
    assert.deepEqual(parseLiteral('9223372036854775808'), { error: 'overflow' })
    assert.deepEqual(parseLiteral('abc'), { error: 'invalid' })
})

test('anonymous placeholders are addressed by their SQLite index', () => {
    assert.deepEqual(labels([anonymous(), anonymous()]), ['?1', '?2'])
    assert.deepEqual(labels([placeholder('?1'), anonymous(), anonymous(), anonymous(), placeholder('?5')]), ['?1', '?2', '?3', '?4', '?5'])
    const result = bindParams('?1 = 1, ?2 = 2', [anonymous(), anonymous()])
    assert.deepEqual(result.params, [1n, 2n])
})

test('repeated named placeholders collapse to one parameter', () => {
    assert.deepEqual(labels([placeholder('$a'), placeholder('$a'), placeholder('$a')]), ['$a'])
    const result = bindParams('a = 1', [placeholder('$a'), placeholder('$a'), placeholder('$a')])
    assert.deepEqual(result.params, [1n])
    // The anonymous placeholder keeps its SQLite index even after a duplicate name.
    assert.deepEqual(labels([placeholder('$a'), placeholder('$a'), anonymous()]), ['$a', '?2'])
})

test('missing definitions, wrong names and bad literals are reported', () => {
    const two = [placeholder(':cid'), placeholder(':session')]
    assert.match(bindParams(null, two).error, /请在语句上方加一行 -- params: cid = …, session = …/)
    assert.match(bindParams('cid = 1', two).error, /缺少参数 :session 的值/)
    assert.match(bindParams('cid = 1, nope = 2', two).error, /nope 不是这条语句的参数（可用：:cid, :session）/)
    assert.match(bindParams("cid = 1, session = abc", two).error, /不是合法字面量；字符串请加单引号/)
    assert.match(bindParams('cid = 1, session = 9223372036854775808', two).error, /超出 64 位整数范围/)
    assert.match(bindParams('cid = 1, session = 2, cid = 3', two).error, /参数 :cid 被定义了两次/)
    assert.match(bindParams('cid 1', two).error, /缺少 =/)
    assert.match(bindParams("cid = '1", two).error, /不是合法字面量/)
})

test('statements without placeholders ignore the block', () => {
    assert.deepEqual(bindParams(null, []), { params: [] })
    assert.deepEqual(bindParams('whatever = 1', []), { params: [] })
})

test('diagnostics show the declared value and warn about missing ones', () => {
    const two = [placeholder(':cid'), placeholder(':session')]
    const declared = paramDiagnostics('cid = 1', two)
    assert.equal(declared.length, 2)
    assert.equal(declared[0].severity, 'info')
    assert.equal(declared[0].message, '参数 1（:cid）= 1')
    assert.equal(declared[1].severity, 'warning')
    assert.match(declared[1].message, /参数 2（:session）未在 -- params: 中定义/)
    const broken = paramDiagnostics('cid = 1, nope = 2', two)
    assert.ok(broken.some((entry) => /nope 不是这条语句的参数/.test(entry.message)))
})
