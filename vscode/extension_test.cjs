// Run after `node build-extension.cjs`: exercises the built VS Code message handler.
const assert = require('assert')
const Module = require('module')
const { Packr, Unpackr } = require('msgpackr')
const utf8Write = Buffer.prototype.utf8Write
const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ mapsAsObjects: true })
const encode = (value) => {
    Buffer.prototype.utf8Write = function (value, offset, length) { return utf8Write.call(this, value, offset, Math.min(length, this.length - offset)) }
    try { return packr.pack(value) } finally { Buffer.prototype.utf8Write = utf8Write }
}
let savedFile
let cellProvider
let cellDraftProvider
let textChanged
let shownDocument
const closeDocument = []
const originalLoad = Module._load
let provider
const vscode = {
    EventEmitter: class { event() {} fire() {} dispose() {} },
    Disposable: class { dispose() {} },
    FileType: { File: 1 },
    FileSystemError: { FileNotFound: (uri) => new Error('not found: ' + uri), NoPermissions: (message) => new Error(message ?? 'no permissions') },
    TabInputText: class { constructor(uri) { this.uri = uri } },
    WorkspaceEdit: class { replace() {} },
    Range: class { constructor(start, end) { this.start = start; this.end = end } },
    Position: class { constructor(line, character) { this.line = line; this.character = character } },
    Uri: { joinPath: (_, ...parts) => ({ toString: () => parts.join('/') }), file: (fsPath) => ({ fsPath }), from: (parts) => ({ ...parts, toString: () => `${parts.scheme}:${parts.path}` }) },
    ViewColumn: { Beside: 2 },
    workspace: { textDocuments: [], onDidChangeTextDocument: (listener) => { textChanged = listener; return {} }, onDidOpenTextDocument: () => ({}), onDidCloseTextDocument: (callback) => { closeDocument.push(callback); return {} }, registerTextDocumentContentProvider: (_, value) => { cellProvider = value; return {} }, registerFileSystemProvider: (_, value) => { cellDraftProvider = value; return {} }, applyEdit: async () => true,
        openTextDocument: async (uri) => uri.scheme === 'sqlite-editor-cell-draft'
            ? { uri, languageId: 'plaintext', isDirty: false, getText: () => cellDraftProvider.readFile(uri).toString('utf8'), save: async () => {}, positionAt: (offset) => ({ offset }) }
            : { uri, text: cellProvider.provideTextDocumentContent(uri) }, fs: { readFile: async (uri) => Buffer.from(uri.fsPath ? 'SELECT 42' : '<html></html>'), writeFile: async (uri, data) => { savedFile = { uri, content: Buffer.from(data).toString('utf8') } } } },
    commands: { registerCommand: () => ({}) },
    languages: { createDiagnosticCollection: () => ({ delete() {}, dispose() {} }), registerCodeLensProvider: () => ({}), registerCompletionItemProvider: () => ({}), setTextDocumentLanguage: async (doc) => doc },
    window: { tabGroups: { all: [], close: async () => {} }, showWarningMessage: async () => undefined, registerCustomEditorProvider: (_, value) => { provider = value; return { dispose() {} } }, showTextDocument: async (doc, opts) => { shownDocument = { doc, opts } }, showSaveDialog: async () => ({ fsPath: '/tmp/query.sql' }), showOpenDialog: async () => [{ fsPath: '/tmp/query.sql' }] },
}
Module._load = function (request, ...args) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args)
}
const { activate } = require('./extension.js')
Module._load = originalLoad

async function main() {
    const storage = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'sqlite-extension-unit-'))
    const context = {
        extensionUri: {}, subscriptions: [], globalStorageUri: { fsPath: storage },
        workspaceState: { keys: () => ['old-state'], get: () => '中文 and long state '.repeat(30) },
    }
    activate(context)
    let handler
    const messages = []
    const settled = async (requestId) => {
        for (let i = 0; i < 200; i++) {
            const message = messages.filter((entry) => entry.requestId === requestId).at(-1)
            if (message) { return message }
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('request ' + requestId + ' was not answered')
    }
    const panel = { onDidDispose: () => ({}), webview: {
        asWebviewUri: (uri) => uri,
        onDidReceiveMessage: (callback) => { handler = callback; return { dispose() {} } },
        postMessage: (message) => messages.push(message),
    } }
    await provider.resolveCustomEditor({ unsupportedScheme: false, uri: { fsPath: '/tmp/test.db' }, watcher: { on() {} } }, panel, {})
    handler({ requestId: 1, path: '/downloadState', body: new Uint8Array() })
    assert.equal(messages.length, 1)
    assert.equal(messages[0].requestId, 1)
    assert.ok(messages[0].body.length > 100)
    handler({ requestId: 2, path: '/saveQueryFile', body: encode({ content: 'SELECT 你好' }) })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(savedFile.content, 'SELECT 你好')
    assert.equal(unpackr.unpack(messages[1].body), '/tmp/query.sql')
    handler({ requestId: 3, path: '/openQueryFile', body: encode({}) })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(unpackr.unpack(messages[2].body).content, 'SELECT 42')
    const json = '{"n":9223372036854775807,"n":2,"text":"中文"}'
    handler({ requestId: 4, path: '/openCellInEditor', body: encode({ content: json, column: 'payload' }) })
    await new Promise((resolve) => setImmediate(resolve))
    assert.match(shownDocument.doc.uri.path, /payload · draft snapshot\.json$/)
    assert.equal(shownDocument.doc.text, '{\n  "n": 9223372036854775807,\n  "n": 2,\n  "text": "中文"\n}')
    assert.equal(shownDocument.opts.viewColumn, vscode.ViewColumn.Beside)
    const uri = shownDocument.doc.uri
    closeDocument.forEach((callback) => callback({ uri }))
    assert.equal(cellProvider.provideTextDocumentContent(uri), '')
    handler({ requestId: 5, path: '/openCellInEditor', body: encode({ content: '{ broken JSON', column: 'bad/path' }) })
    await new Promise((resolve) => setImmediate(resolve))
    assert.match(shownDocument.doc.uri.path, /bad_path · draft snapshot\.txt$/)
    assert.equal(shownDocument.doc.text, '{ broken JSON')

    handler({ requestId: 6, path: '/openCellDraft', body: encode({ table: 'runs', column: 'payload', row: 'rowid = 2', value: json }) })
    await new Promise((resolve) => setImmediate(resolve))
    const draft = unpackr.unpack(messages.at(-1).body)
    assert.equal(draft.open, true)
    assert.equal(draft.dirty, false)
    assert.equal(draft.text, '{\n  "n": 9223372036854775807,\n  "n": 2,\n  "text": "中文"\n}')
    assert.match(shownDocument.doc.uri.path, /runs · rowid = 2 · payload\.json$/)
    textChanged({ document: { uri: shownDocument.doc.uri, getText: () => 'edited' } })
    assert.equal(messages.at(-1).type, 'sqlite-editor-cell-draft')
    assert.equal(messages.at(-1).dirty, true)
    assert.equal(messages.at(-1).text, 'edited')
    handler({ requestId: 7, path: '/closeCellDraft', body: encode({ key: draft.key, discard: true }) })
    const closed = await settled(7)
    assert.equal(unpackr.unpack(closed.body).open, false)
    console.log('workspace state message encoded successfully')
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
