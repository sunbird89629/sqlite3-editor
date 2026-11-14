// Run with `npm test` in vscode/ (after build-extension.cjs): drives the built extension through
// the Run link with a stubbed vscode API, so a silent path in that chain fails the suite.
const assert = require('assert')
const Module = require('module')

let panels = []
let posted = []
let registered = new Map()
let warned = []
let errors = []
let logs = []

const disposable = () => ({ dispose() {} })
const vscode = {
    EventEmitter: class { constructor() { this.event = () => disposable() } fire() {} dispose() {} },
    Disposable: class { dispose() {} },
    Uri: { joinPath: (_base, ...parts) => ({ fsPath: parts.join('/'), toString: () => parts.join('/') }), from: (parts) => ({ ...parts, toString: () => parts.scheme + ':' + parts.path }) },
    Range: class { constructor(...args) { this.args = args } },
    CodeLens: class { constructor(range, command) { this.range = range; this.command = command } },
    ViewColumn: { Beside: 2 },
    CompletionList: class { constructor(items) { this.items = items } },
    CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind } },
    CompletionItemKind: { Field: 1, Class: 2, Keyword: 3 },
    window: {
        createWebviewPanel: (viewType, title, column, options) => {
            const panel = {
                viewType, title, column, options, disposed: false,
                webview: {
                    html: '',
                    postMessage: (message) => { posted.push(message); return Promise.resolve(true) },
                    onDidReceiveMessage: () => disposable(),
                    asWebviewUri: (uri) => uri,
                },
                onDidDispose: () => disposable(),
                reveal() {},
                dispose() { this.disposed = true },
            }
            panels.push(panel)
            return panel
        },
        showErrorMessage: (message) => { errors.push(message); return Promise.resolve(undefined) },
        showWarningMessage: (message) => { warned.push(message); return Promise.resolve(undefined) },
        showInformationMessage: () => Promise.resolve(undefined),
        createOutputChannel: () => ({ appendLine: (line) => logs.push(line), append: () => {}, dispose: () => {} }),
        activeTextEditor: undefined,
    },
    commands: { registerCommand: (id, handler) => { registered.set(id, handler); return disposable() } },
    languages: { registerCodeLensProvider: () => disposable(), registerCompletionItemProvider: () => disposable() },
    workspace: {
        fs: { readFile: async () => Buffer.from('<html><script src="/assets/results.js"></script></html>') },
        openTextDocument: async () => ({}), showTextDocument: async () => ({}),
        onDidCloseTextDocument: () => disposable(),
        textDocuments: [],
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => undefined }),
    },
}
const originalLoad = Module._load
Module._load = function (request, ...args) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args) }

const { registerQueryEditor } = require('./extension.js')

const context = { subscriptions: [], workspaceState: { keys: () => [], get: () => undefined, update: async () => {} }, extensionUri: { path: '/ext', scheme: 'file' } }
const controller = registerQueryEditor(context, { openSnapshot: () => {} })

const client = {
    query: async (sql, params) => ({ columns: ['conversation_id', 'kind'], records: [{ conversation_id: params[0], kind: 'chunk' }] }),
    request() {}, close: async () => {}, label: 'test',
}
controller.addConnection('local/evaluation', client)

;(async () => {
    const run = registered.get('sqlite3-editor.runStatement')
    assert.ok(run, 'runStatement is registered')
    await run('local/evaluation', 'SELECT * FROM turn_events WHERE conversation_id=:conversation_id', "conversation_id='abc'")
    console.log('panels created:', panels.length, panels.map((panel) => panel.title))
    console.log('messages posted:', posted.map((message) => message.type ?? message.command))
    console.log('errors:', errors, 'warnings:', warned)
    const message = posted.find((entry) => entry.type === 'sqlite3-editor-results')
    console.log('tabs in payload:', message?.tabs?.length, JSON.stringify(message?.tabs?.[0]?.columns))
    console.log('log lines:'); for (const line of logs) { console.log('  ' + line) }
    process.exit(0)
})().catch((err) => { console.error('FAILED:', err); process.exit(1) })
