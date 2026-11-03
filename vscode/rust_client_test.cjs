// Run after building the extension and Rust backend; uses a disposable database.
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { Packr, Unpackr } = require('msgpackr')
// The test's direct msgpackr import lacks the build-time compatibility patch.
const utf8Write = Buffer.prototype.utf8Write
const load = Module._load
Module._load = function (name, ...args) { return name === 'vscode' ? { window: { showErrorMessage: console.error } } : load.call(this, name, ...args) }
const { LocalPythonClient } = require('./extension.js')
Module._load = load

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })
const encode = (value) => {
    Buffer.prototype.utf8Write = function (value, offset, length) { return utf8Write.call(this, value, offset, Math.min(length, this.length - offset)) }
    try { return packr.pack(value) } finally { Buffer.prototype.utf8Write = utf8Write }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-editor-rust-test-'))
process.on('exit', () => { fs.rmSync(dir, { recursive: true, force: true }) })
const db = path.join(dir, 'test.db')
fs.writeFileSync(db, '')
const binary = path.join(__dirname, 'bin', `sqlite3-editor-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`)
const client = new LocalPythonClient('', '', db, binary)
const query = (sql, params = [], mode = 'r') => new Promise((resolve, reject) => {
    client.request(encode({ query: sql, params, mode }), (data) => resolve(unpackr.unpack(data)), reject)
})

async function main() {
    try {
        await query('CREATE TABLE t (n INTEGER, r REAL, s TEXT, b BLOB)', [], 'w+')
        await query('INSERT INTO t VALUES (?, ?, ?, ?)', [9223372036854775807n, 1.0, 'hello', Buffer.from([0, 255])], 'w+')
        const result = await query('SELECT * FROM t')
        assert.equal(result.records[0].n, 9223372036854775807n)
        assert.equal(result.records[0].r, 1)
        assert.equal(result.records[0].s, 'hello')
        assert.deepEqual(Array.from(result.records[0].b), [0, 255])
        assert.ok((await query('PRAGMA table_list')).records.some((record) => record.name === 't'))
        assert.equal((await query('PRAGMA table_info("t")')).records.length, 4)
        assert.ok((await query('PRAGMA journal_mode')).records.length > 0)
        assert.equal((await query("SELECT find_widget_regexp('hello world', 'hello', 1, 1) AS found")).records[0].found, 1n)
        await assert.rejects(query('DELETE FROM t'), /read.only/i)
        await assert.rejects(query('PRAGMA user_version = 5'), /read.only/i)
        await assert.rejects(query("SELECT load_extension('not-a-real-library')"), /not authorized/i)
        await assert.rejects(query("INSERT INTO t VALUES (2, 2, 'a', x'00'); INSERT INTO t VALUES (3, 3, 'b', x'00')", [], 'w+'))
        assert.equal((await query("SELECT ';' AS value; -- trailing comment")).records[0].value, ';')
        await query('CREATE TRIGGER test_trigger AFTER INSERT ON t BEGIN UPDATE t SET s=s WHERE rowid=NEW.rowid; END;', [], 'w+')
        assert.equal((await query('SELECT COUNT(*) AS n FROM t')).records[0].n, 1n)
        const lenses = await client.command('code_lens', ['-- 中文😀\nSELECT 1; SELECT * FROM t;'])
        assert.equal(lenses.length, 2)
        assert.equal(lenses[1].stmt_executed, 'SELECT * FROM t;')
        const completions = await client.command('completion', ['SELECT * FROM t', 0n, 15n])
        assert.ok(completions.table_names.some((entry) => entry.table === 't'))
        assert.ok((await client.command('check_syntax', ["SELECT 'unterminated"])).length)
        assert.equal((await query('SELECT COUNT(*) AS n FROM t')).records[0].n, 1n)
        console.log('Rust client query, types, search and read-only checks passed')
    } finally { client.close() }
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
