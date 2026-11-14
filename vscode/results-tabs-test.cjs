// Run with `npm test` in vscode/: checks the results tab model.
const assert = require('assert')
const { addTab, closeTab, replaceTab, tabLabel, RESULT_TAB_LIMIT } = require('./.tmp/results-tabs.cjs')

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

console.log('results-tabs: all assertions passed')
