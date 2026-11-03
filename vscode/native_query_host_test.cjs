// Run with --extensionDevelopmentPath=vscode --extensionTestsPath=vscode/native_query_host_test.cjs.
const vscode = require('vscode')
const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

exports.run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-keyword-host-'))
    const db = path.join(dir, 'verify.db')
    fs.writeFileSync(db, '')
    try {
        await vscode.extensions.getExtension('yy0931.vscode-sqlite3-editor').activate()
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: `-- database: ${db}\nsel` })
        await vscode.window.showTextDocument(doc)
        const completions = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(1, 3))
        const keywords = completions.items.filter((item) => item.detail === 'SQLite keyword')
        for (const word of ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INSERT', 'UPDATE', 'CREATE', 'WITH', 'RETURNING']) {
            assert.ok(keywords.some((item) => item.label === word && item.kind === vscode.CompletionItemKind.Keyword), `missing ${word}`)
        }
        const normal = await vscode.workspace.openTextDocument({ language: 'sql', content: 'sel' })
        const normalItems = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', normal.uri, new vscode.Position(0, 3))
        assert.ok(!normalItems.items.some((item) => item.detail === 'SQLite keyword'))
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(db), 'sqlite3-editor.editor')
        const connectedItems = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(1, 3))
        assert.ok(connectedItems.items.some((item) => item.label === 'SELECT' && item.detail === 'SQLite keyword'))
        console.log('HOST PASS SQL keywords with and without a database connection')
    } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        fs.rmSync(dir, { recursive: true, force: true })
    }
}
