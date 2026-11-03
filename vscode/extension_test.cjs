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
const originalLoad = Module._load
let provider
const vscode = {
    EventEmitter: class { event() {} fire() {} dispose() {} },
    Uri: { joinPath: (_, ...parts) => ({ toString: () => parts.join('/') }), file: (fsPath) => ({ fsPath }) },
    workspace: { textDocuments: [], onDidChangeTextDocument: () => ({}), onDidOpenTextDocument: () => ({}), onDidCloseTextDocument: () => ({}), fs: { readFile: async (uri) => Buffer.from(uri.fsPath ? 'SELECT 42' : '<html></html>'), writeFile: async (uri, data) => { savedFile = { uri, content: Buffer.from(data).toString('utf8') } } } },
    commands: { registerCommand: () => ({}) },
    languages: { createDiagnosticCollection: () => ({ dispose() {} }), registerCodeLensProvider: () => ({}), registerCompletionItemProvider: () => ({}) },
    window: { registerCustomEditorProvider: (_, value) => { provider = value; return { dispose() {} } }, showSaveDialog: async () => ({ fsPath: '/tmp/query.sql' }), showOpenDialog: async () => [{ fsPath: '/tmp/query.sql' }] },
}
Module._load = function (request, ...args) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args)
}
const { activate } = require('./extension.js')
Module._load = originalLoad

async function main() {
    const context = {
        extensionUri: {}, subscriptions: [],
        workspaceState: { keys: () => ['old-state'], get: () => '中文 and long state '.repeat(30) },
    }
    activate(context)
    let handler
    const messages = []
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
    console.log('workspace state message encoded successfully')
}
main().catch((err) => { console.error(err); process.exitCode = 1 })
