const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('@playwright/test')
exports.run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-row-preview-'))
    const db = path.join(dir, 'sample.db')
    execFileSync('sqlite3', [db, "CREATE TABLE records (id INTEGER PRIMARY KEY, payload TEXT, data BLOB); INSERT INTO records VALUES (1,'first',X'00FF'),(2,'second',X'AB');"])
    try {
        await vscode.extensions.getExtension('yy0931.vscode-sqlite3-editor').activate()
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(db), 'sqlite3-editor.editor')
        const browser = await chromium.connectOverCDP('http://127.0.0.1:' + process.env.ROW_TEST_CDP_PORT)
        let table
        const until = Date.now() + 15000
        while (!table && Date.now() < until) {
            for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) {
                try { if (await frame.getByTestId('row number 1').count()) table = frame } catch {}
            }
            if (!table) await new Promise((resolve) => setTimeout(resolve, 100))
        }
        assert.ok(table, 'database table rendered')
        await table.getByTestId('row number 1').click()
        let deadline = Date.now() + 5000
        while (vscode.window.activeTextEditor?.document.uri.scheme !== 'sqlite-editor-cell' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
        let doc = vscode.window.activeTextEditor?.document
        assert.equal(doc?.uri.scheme, 'sqlite-editor-cell')
        const first = JSON.parse(doc.getText())
        assert.equal(first.payload, 'first')
        assert.deepEqual(first.data, { type: 'BLOB', hex: '00ff' })
        assert.ok((await table.getByTestId('row number 1').locator('..').getAttribute('class')).includes('editing'))
        await table.getByTestId('row number 2').click()
        deadline = Date.now() + 5000
        while (vscode.window.activeTextEditor?.document.uri.toString() === doc.uri.toString() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
        doc = vscode.window.activeTextEditor?.document
        assert.equal(JSON.parse(doc.getText()).payload, 'second')
        const previewTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'sqlite-editor-cell')
        assert.equal(previewTabs.length, 1, 'row previews replace the previous preview tab')
        assert.equal(previewTabs[0].isPreview, true)
        console.log('HOST PASS row numbers open a read-only native preview with correct record values')
    } catch (error) { console.error('ROW HOST TEST FAILURE', error); throw error }
    finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
