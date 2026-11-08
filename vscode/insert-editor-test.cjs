const assert = require('node:assert/strict')
const { test } = require('node:test')
const esbuild = require('esbuild')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { Unpackr } = require('msgpackr')
const unpackr = new Unpackr({ mapsAsObjects: true, useRecords: true, int64AsNumber: false })

const directories = []
test.after(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }) })
function setup(storage) {
    if (!storage) { storage = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-insert-unit-')); directories.push(storage) }
    let editor, fsProvider, warningChoice, currentPanel
    const commands = [], messages = []
    class EventEmitter { constructor() { this.handlers = []; this.event = (fn) => { this.handlers.push(fn); return { dispose() {} } } } fire(value) { for (const fn of this.handlers) fn(value) } dispose() {} }
    class Uri { constructor(scheme, pathname) { this.scheme = scheme; this.path = pathname } toString() { return this.scheme + ':' + this.path } static from({ scheme, path }) { return new Uri(scheme, path) } static parse(value) { const i = value.indexOf(':'); return new Uri(value.slice(0, i), value.slice(i + 1)) } }
    const api = {
        EventEmitter, Uri, Disposable: class { dispose() {} }, FileType: { File: 1 }, FileSystemError: { FileNotFound: () => new Error('not found') }, ViewColumn: { Beside: -2 },
        window: {
            registerCustomEditorProvider(_type, provider) { editor = provider; return { dispose() {} } },
            showWarningMessage: async () => warningChoice,
            showTextDocument: async () => {},
        },
        workspace: {
            registerFileSystemProvider(_scheme, provider) { fsProvider = provider; return { dispose() {} } },
            fs: { writeFile: async () => {}, delete: async () => {}, readFile: async () => Buffer.alloc(0) },
        },
        commands: { async executeCommand(...args) { commands.push(args); if (args[0] === 'vscode.openWith') { const uri = args[1]; fsProvider.stat(uri); const doc = await editor.openCustomDocument(uri, {}); const panel = { visible: true, viewColumn: 2, webview: { cspSource: 'vscode-webview:', postMessage: async (m) => { messages.push(m) }, onDidReceiveMessage: (fn) => { panel.receive = fn } }, onDidDispose() {}, onDidChangeViewState() {} }; currentPanel = panel; await editor.resolveCustomEditor(doc, panel); panel.doc = doc } } },
    }
    const { outputFiles } = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'insert-editor.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false })
    const moduleShim = { exports: {} }
    const customRequire = (name) => name === 'vscode' ? api : require(name)
    new Function('module', 'exports', 'require', outputFiles[0].text)(moduleShim, moduleShim.exports, customRequire)
    const context = { subscriptions: [], globalStorageUri: { fsPath: storage } }
    const insert = moduleShim.exports.registerInsertEditor(context)
    return { insert, storage, commands, messages, get panel() { return currentPanel }, get editor() { return editor }, set warning(value) { warningChoice = value } }
}

test('right editor binds draft to original table, retains it after failure, and refreshes on success', async () => {
    const env = setup(), calls = []
    let fail = true, refresh = 0
    const conn = { request(body, ok, error) { calls.push(unpackr.unpack(body)); if (fail) error(new Error('constraint failed')); else ok(Buffer.from([0xc0])) } }
    await env.insert.open(conn, { database: '/test.db', table: 'original', fields: [{ name: 'payload', type: 'string', value: '', blob: null }] }, () => { refresh++ })
    assert.match(env.panel.webview.html, /新增记录/)
    await env.panel.receive({ type: 'ready' })
    await env.panel.receive({ type: 'edit', index: 0, field: { name: 'payload', type: 'string', value: 'draft', blob: null } })
    assert.equal(await env.insert.guard('/test.db'), false)
    env.warning = 'Keep draft'
    assert.equal(await env.insert.guard('/test.db'), true)
    await env.panel.receive({ type: 'insert' })
    assert.equal(env.messages.at(-1).ok, false)
    assert.equal(env.panel.doc.model.draft.fields[0].value, 'draft')
    fail = false
    await env.panel.receive({ type: 'insert' })
    assert.equal(env.messages.at(-1).ok, true)
    assert.equal(calls[1].query, 'INSERT INTO "original" ("payload") VALUES (?)')
    assert.deepEqual(calls[1].params, ['draft'])
    assert.equal(refresh, 1)
    await env.panel.receive({ type: 'insert' })
    assert.equal(calls.length, 2, 'repeated click must not insert twice')
})

test('saving and reverting the editor only persists drafts and never writes SQLite', async () => {
    const env = setup(); let writes = 0
    const conn = { request() { writes++ } }
    await env.insert.open(conn, { database: '/test.db', table: 't', fields: [{ name: 'v', type: 'string', value: '', blob: null }] }, () => {})
    await env.panel.receive({ type: 'edit', index: 0, field: { name: 'v', type: 'string', value: 'saved', blob: null } })
    const doc = env.panel.doc
    await env.editor.saveCustomDocument(doc)
    await env.panel.receive({ type: 'edit', index: 0, field: { name: 'v', type: 'string', value: 'later', blob: null } })
    await env.editor.revertCustomDocument(doc)
    assert.equal(writes, 0)
    assert.equal(doc.model.draft.fields[0].value, 'saved')
    assert.equal(await env.insert.guard('/test.db'), false)
    assert.equal(writes, 0)
})

test('saved drafts restore with their database identity and remain protected', async () => {
    const env = setup(), conn = { request() {} }
    await env.insert.open(conn, { database: '/test.db', table: 't', fields: [{ name: 'v', type: 'string', value: '', blob: null }] }, () => {})
    await env.panel.receive({ type: 'edit', index: 0, field: { name: 'v', type: 'string', value: 'recover me', blob: null } })
    await env.editor.saveCustomDocument(env.panel.doc)
    const uri = env.panel.doc.uri
    const restarted = setup(env.storage)
    restarted.insert.attach('/test.db', conn, () => {})
    await restarted.insert.open(conn, { database: '/test.db', table: 't', fields: [{ name: 'v', type: 'string', value: '', blob: null }] }, () => {})
    const restored = restarted.panel.doc
    assert.equal(restored.uri.toString(), uri.toString())
    assert.equal(restored.model.draft.fields[0].value, 'recover me')
    assert.equal(restored.model.draft.database, '/test.db')
    assert.equal(await restarted.insert.guard('/test.db'), false)
})
