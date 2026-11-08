const assert = require('node:assert/strict')
const { test } = require('node:test')
const esbuild = require('esbuild')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const directories = []
test.after(() => { for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true }) })

function setup(existing) {
    const storage = existing ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-cell-unit-'))
    if (!existing) { directories.push(storage) }
    let fsProvider, changeListener, shown = [], closedTabs = []
    const messages = []
    class EventEmitter { constructor() { this.handlers = []; this.event = (fn) => { this.handlers.push(fn); return { dispose() {} } } } fire(value) { for (const fn of this.handlers) fn(value) } dispose() {} }
    class TabInputText { constructor(uri) { this.uri = uri } }
    class WorkspaceEdit { constructor() { this.operations = [] } replace(uri, _range, text) { this.operations.push({ uri, text }) } }
    class Uri {
        constructor(scheme, pathname) { this.scheme = scheme; this.path = pathname }
        toString() { return this.scheme + ':' + this.path }
        static from({ scheme, path }) { return new Uri(scheme, path) }
    }
    const docs = new Map()
    const document = (uri) => {
        const key = uri.toString()
        if (!docs.has(key)) {
            const doc = {
                uri, languageId: 'plaintext', dirty: false,
                get isDirty() { return doc.dirty },
                getText: () => fsProvider.readFile(uri).toString('utf8'),
                async save() { await fsProvider.writeFile(uri, Buffer.from(doc.getText(), 'utf8'), { create: false, overwrite: true }); doc.dirty = false },
                positionAt: (offset) => ({ offset }),
            }
            docs.set(key, doc)
        }
        return docs.get(key)
    }
    const api = {
        EventEmitter, Uri, TabInputText, WorkspaceEdit, Range: class { constructor(start, end) { this.start = start; this.end = end } },
        Disposable: class { dispose() {} }, FileType: { File: 1 },
        FileSystemError: { FileNotFound: (uri) => new Error('not found: ' + uri), NoPermissions: (message) => new Error(message ?? 'no permissions') },
        ViewColumn: { Beside: -2 },
        window: {
            async showTextDocument(doc, options) { shown.push({ doc, options }); return doc },
            get tabGroups() {
                return { all: [{ tabs: shown.length ? [{ input: new TabInputText(shown.at(-1).doc.uri) }] : [] }], async close(tab) { closedTabs.push(tab); shown = shown.filter((entry) => entry.doc.uri.toString() !== tab.input.uri.toString()) } }
            },
            showWarningMessage: async () => undefined,
        },
        languages: { async setTextDocumentLanguage(doc, languageId) { doc.languageId = languageId; return doc } },
        workspace: {
            registerFileSystemProvider(_scheme, provider) { fsProvider = provider; return { dispose() {} } },
            onDidChangeTextDocument(listener) { changeListener = listener; return { dispose() {} } },
            async applyEdit(edit) {
                for (const { uri, text } of edit.operations) {
                    fsProvider.writeFile(uri, Buffer.from(text, 'utf8'), { create: false, overwrite: true })
                    document(uri).dirty = true
                    changeListener({ document: { uri, getText: () => text } })
                }
                return true
            },
            async openTextDocument(uri) { return document(uri) },
        },
    }
    const { outputFiles } = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'cell-editor.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false })
    const moduleShim = { exports: {} }
    const customRequire = (name) => name === 'vscode' ? api : require(name)
    new Function('module', 'exports', 'require', outputFiles[0].text)(moduleShim, moduleShim.exports, customRequire)
    const context = { subscriptions: [], globalStorageUri: { fsPath: storage } }
    const cellEditor = moduleShim.exports.registerCellEditor(context)
    const panel = { viewColumn: 1, webview: { postMessage: async (message) => { messages.push(message) } } }
    cellEditor.addPanel('/app.db', panel)
    const type = (uri, text) => {
        const doc = document(uri)
        doc.dirty = true
        fsProvider.writeFile(uri, Buffer.from(text, 'utf8'), { create: false, overwrite: true })
        changeListener({ document: { uri, getText: () => text } })
    }
    return { cellEditor, storage, panel, messages, fsProvider, type, document, get shown() { return shown }, get closedTabs() { return closedTabs } }
}

const stored = (storage) => fs.existsSync(path.join(storage, 'cell-drafts'))
    ? fs.readdirSync(path.join(storage, 'cell-drafts')).map((name) => JSON.parse(fs.readFileSync(path.join(storage, 'cell-drafts', name), 'utf8')))
    : []

test('a cell draft opens in the column right of the webview and reports JSON formatting', async () => {
    const env = setup()
    const value = '{"b":1,"a":[2,3]}'
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value })
    assert.equal(env.shown.at(-1).options.viewColumn, 2)
    assert.equal(env.shown.at(-1).options.preview, false)
    assert.match(env.shown.at(-1).doc.uri.toString(), /runs · rowid = 2 · payload\.json$/)
    assert.equal(env.shown.at(-1).doc.languageId, 'json')
    assert.equal(snapshot.text, '{\n  "b": 1,\n  "a": [\n    2,\n    3\n  ]\n}')
    assert.equal(snapshot.dirty, false)
    assert.equal(snapshot.open, true)
    assert.deepEqual(env.messages.at(-1), { type: 'sqlite-editor-cell-draft', key: snapshot.key, text: snapshot.text, dirty: false, open: true })
})

test('plain text stays plain and keeps its exact bytes', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 3', value: 'not { json' })
    assert.equal(snapshot.text, 'not { json')
    assert.equal(env.shown.at(-1).doc.languageId, 'plaintext')
    assert.match(env.shown.at(-1).doc.uri.toString(), /payload\.txt$/)
})

test('typing marks the draft dirty and Ctrl+S stores it without touching the database', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    env.type(env.shown.at(-1).doc.uri, 'new')
    assert.equal(env.messages.at(-1).text, 'new')
    assert.equal(env.messages.at(-1).dirty, true)
    await env.document(env.shown.at(-1).doc.uri).save()
    assert.equal(stored(env.storage).length, 1)
    assert.equal(stored(env.storage)[0].text, 'new')
    assert.equal(stored(env.storage)[0].key, snapshot.key)
})

test('a stored draft is restored when the same cell is opened again', async () => {
    const first = setup()
    await first.cellEditor.open(first.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    first.type(first.shown.at(-1).doc.uri, 'kept draft')
    await first.document(first.shown.at(-1).doc.uri).save()
    await first.cellEditor.close(first.messages.at(-1).key, false)

    const second = setup(first.storage)
    const snapshot = await second.cellEditor.open(second.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    assert.equal(snapshot.text, 'kept draft')
    assert.equal(snapshot.dirty, true)
})

test('closing with discard deletes the draft and the tab', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    env.type(env.shown.at(-1).doc.uri, 'new')
    assert.equal(env.closedTabs.length, 0)
    const result = await env.cellEditor.close(snapshot.key, true)
    assert.equal(result.open, false)
    assert.equal(env.closedTabs.length, 1)
    assert.equal(stored(env.storage).length, 0)
    assert.equal(env.messages.at(-1).open, false)
    assert.equal(env.cellEditor.snapshot(snapshot.key), null)
})

test('closing without discard keeps the draft text for reopening', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    env.type(env.shown.at(-1).doc.uri, 'kept')
    const result = await env.cellEditor.close(snapshot.key, false)
    assert.equal(result.open, false)
    assert.equal(result.text, 'kept')
    const reopened = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    assert.equal(reopened.text, 'kept')
    assert.equal(reopened.open, true)
})

test('drafts of other databases and closed databases do not leak', async () => {
    const env = setup()
    const other = { viewColumn: 1, webview: { postMessage: async () => {} } }
    env.cellEditor.addPanel('/other.db', other)
    await env.cellEditor.open(other, '/other.db', { table: 't', column: 'c', row: 'id = 1', value: 'x' })
    const before = env.messages.length
    await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'y' })
    assert.equal(env.messages.filter((message) => message.key !== undefined).length, before + 1)
    await env.cellEditor.detach('/other.db')
    assert.equal(env.cellEditor.snapshot([...env.messages].reverse().find((message) => message.text === 'x')?.key ?? ''), null)
})

test('typing into the cell replaces the draft text in the editor document', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    const result = await env.cellEditor.setText(snapshot.key, 'typed in the cell')
    assert.equal(result.text, 'typed in the cell')
    assert.equal(result.dirty, true)
    assert.equal(env.fsProvider.readFile(env.shown.at(-1).doc.uri).toString('utf8'), 'typed in the cell')
    assert.equal(env.messages.at(-1).text, 'typed in the cell')
})

test('a closed draft rejects further text updates', async () => {
    const env = setup()
    const snapshot = await env.cellEditor.open(env.panel, '/app.db', { table: 'runs', column: 'payload', row: 'rowid = 2', value: 'old' })
    await env.cellEditor.close(snapshot.key, true)
    await assert.rejects(() => env.cellEditor.setText(snapshot.key, 'later'), /cell draft is closed/)
})
