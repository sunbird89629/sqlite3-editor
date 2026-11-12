// Run with `npm test` in vscode/: checks the statement splitter used for the editor's Run links.
const assert = require('assert')
const { splitStatements } = require('./.tmp/sql-statements.cjs')

const doc = [
    '-- database: local/evaluation',
    '',
    'SELECT * FROM `turn_events`;',
    '',
    '',
    '',
    'SELECT * FROM runs LIMIT 10;',
].join('\n')
assert.deepStrictEqual(splitStatements(doc).map((s) => [s.line, s.sql]), [
    [2, 'SELECT * FROM `turn_events`'],
    [6, 'SELECT * FROM runs LIMIT 10'],
])

// A semicolon inside a literal or a comment does not split.
assert.deepStrictEqual(splitStatements("SELECT 'a;b' AS x; SELECT 1").map((s) => s.sql), ["SELECT 'a;b' AS x", 'SELECT 1'])
assert.deepStrictEqual(splitStatements('SELECT 1 /* ; */ ; SELECT 2').map((s) => s.sql), ['SELECT 1 /* ; */', 'SELECT 2'])
assert.deepStrictEqual(splitStatements('SELECT 1 -- trailing ;\n; SELECT 2').map((s) => s.sql), ['SELECT 1 -- trailing ;', 'SELECT 2'])

// Two statements on one line, and a document that is only a header.
assert.deepStrictEqual(splitStatements('SELECT 1; SELECT 2;').map((s) => s.line), [0, 0])
assert.deepStrictEqual(splitStatements('-- database: x\n\n;'), [])
assert.deepStrictEqual(splitStatements('SELECT "quoted ; text" FROM t'), [{ sql: 'SELECT "quoted ; text" FROM t', line: 0 }])

console.log('sql-statements: all assertions passed')
