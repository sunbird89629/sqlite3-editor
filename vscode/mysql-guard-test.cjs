// Run with `npm test` in vscode/: bundles mysql-guard.ts and checks the read-only allow list.
const assert = require('assert')
const { assertReadOnly, stripCommentsAndLiterals, ReadOnlyViolation } = require('./.tmp/mysql-guard.cjs')

const rejected = [
    'DELETE FROM t',
    'update t set a = 1',
    'INSERT INTO t VALUES (1)',
    'REPLACE INTO t VALUES (1)',
    'CREATE TABLE t (a int)',
    'ALTER TABLE t ADD COLUMN b int',
    'DROP TABLE t',
    'TRUNCATE TABLE t',
    'RENAME TABLE a TO b',
    'SET GLOBAL read_only = 0',
    'CALL p()',
    '/*!50000 DELETE FROM t */',
    '/*!50000DELETE FROM t*/',
    'WITH x AS (SELECT 1) DELETE FROM t',
    'WITH x AS (SELECT 1) UPDATE t SET a = 1',
    'SELECT 1; DELETE FROM t',
    "SELECT 'DELETE FROM t' FROM t; DELETE FROM t",
    'SELECT * INTO OUTFILE "/tmp/x" FROM t',
    '# comment\nDROP TABLE t',
    '-- comment\nDROP TABLE t',
    '',
    '   ',
]

const allowed = [
    'SELECT * FROM t',
    'select 1',
    'SHOW TABLES',
    'SHOW CREATE TABLE t',
    'DESCRIBE t',
    'DESC t',
    'EXPLAIN SELECT 1',
    'TABLE t',
    "SELECT 'insert into t values (1)' AS s",
    'SELECT `delete` FROM t',
    'SELECT 1 /* DELETE FROM t */',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'SELECT 1;',
]

for (const sql of rejected) {
    assert.throws(() => assertReadOnly(sql), ReadOnlyViolation, `expected rejection: ${JSON.stringify(sql)}`)
}
for (const sql of allowed) {
    assert.doesNotThrow(() => assertReadOnly(sql), `expected acceptance: ${JSON.stringify(sql)}`)
}

// Literal contents must not leak into the statement structure.
assert.strictEqual(stripCommentsAndLiterals("SELECT 'a;b'").includes(';'), false)
assert.strictEqual(stripCommentsAndLiterals('/*!50000 DELETE */').trim(), 'DELETE')

console.log(`mysql-guard: ${rejected.length} rejected, ${allowed.length} allowed, all assertions passed`)
