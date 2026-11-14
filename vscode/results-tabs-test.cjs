// Run with `npm test` in vscode/: checks the results tab model.
const assert = require('assert')
const { addTab, closeTab, replaceTab, tabLabel, statementSummary, RESULT_TAB_LIMIT } = require('./.tmp/results-tabs.cjs')

const tab = (id) => ({ id, sql: `SELECT ${id}`, columns: ['a'], rows: [['1']], total: 1, durationMs: 1 })

// The list keeps at most five and evicts the oldest.
let tabs = []
for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) { tabs = addTab(tabs, tab(id)) }
assert.deepStrictEqual(tabs.map((t) => t.id), ['b', 'c', 'd', 'e', 'f'])
assert.strictEqual(tabs.length, RESULT_TAB_LIMIT)

// Closing removes exactly one.
assert.deepStrictEqual(closeTab(tabs, 'c').map((t) => t.id), ['b', 'd', 'e', 'f'])
// An unknown id leaves the list untouched.
assert.deepStrictEqual(closeTab(tabs, 'missing').map((t) => t.id), ['b', 'c', 'd', 'e', 'f'])

// Re-run replaces the data but keeps the id and position.
const replaced = replaceTab(tabs, 'd', { sql: 'SELECT d', columns: ['x', 'y'], rows: [['1', '2']], total: 9, durationMs: 7 })
assert.deepStrictEqual(replaced.map((t) => t.id), ['b', 'c', 'd', 'e', 'f'])
assert.deepStrictEqual(replaced[2].columns, ['x', 'y'])
assert.strictEqual(replaced[2].total, 9)

// Titles are single line and bounded.
assert.strictEqual(tabLabel('SELECT\n  * FROM runs'), 'SELECT * FROM runs')
assert.strictEqual(tabLabel('x'.repeat(80)).length, 48)
assert.ok(tabLabel('x'.repeat(80)).endsWith('…'))

// Tab labels drop comments, so a SELECT whose columns were commented out stays readable.
assert.strictEqual(
    statementSummary([
        'SELECT',
        '    -- sequence,',
        '    -- kind,',
        '    -- payload',
        "    message_content",
        'FROM turn_events',
    ].join('\n')),
    'SELECT message_content FROM turn_events',
)
// A long statement is truncated rather than wrapped.
assert.ok(statementSummary([
    'SELECT',
    '    -- sequence,',
    "    JSON_UNQUOTE(JSON_EXTRACT(payload, '$.content.message')) AS message_content",
    'FROM turn_events',
].join('\n')).startsWith('SELECT JSON_UNQUOTE'))
assert.strictEqual(statementSummary('SELECT /* c */ 1'), 'SELECT 1')
assert.strictEqual(statementSummary("SELECT '-- not a comment'"), "SELECT '-- not a comment'")
assert.strictEqual(statementSummary('x'.repeat(100)).length, 72)

console.log('results-tabs: all assertions passed')
