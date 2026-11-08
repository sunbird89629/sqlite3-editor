// Run in an isolated VS Code extension development host with a Chromium debugging port.
const vscode = require('vscode')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('@playwright/test')

exports.run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-insert-host-'))
    const db = path.join(dir, 'sample.db')
    execFileSync('sqlite3', [db, "CREATE TABLE records (id TEXT PRIMARY KEY, payload TEXT); INSERT INTO records VALUES ('existing','old'); WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<11) INSERT INTO records SELECT 'row-'||x, 'old' FROM n;"])
    let browser
    try {
        await vscode.workspace.getConfiguration('window').update('dialogStyle', 'custom', vscode.ConfigurationTarget.Global)
        await vscode.extensions.getExtension('yy0931.vscode-sqlite3-editor').activate()
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(db), 'sqlite3-editor.editor')
        browser = await chromium.connectOverCDP('http://127.0.0.1:' + process.env.INSERT_TEST_CDP_PORT)
        const waitFrame = async (selector) => {
            const deadline = Date.now() + 20000
            while (Date.now() < deadline) {
                for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) {
                    try { if (await frame.locator(selector).count()) return frame } catch {}
                }
                await new Promise((resolve) => setTimeout(resolve, 150))
            }
            throw new Error('Could not find VS Code webview element: ' + selector)
        }
        const table = await waitFrame('[data-testid="open-insert-editor"]')
        await table.locator('[data-testid="open-insert-editor"]').click()
        let form = await waitFrame('#insert')
        await form.locator('select').nth(0).selectOption('string')
        await form.locator('textarea').nth(0).fill('existing')
        await form.locator('select').nth(1).selectOption('string')
        await form.locator('textarea').nth(1).fill('{"test":true}')
        await form.locator('#insert').click()
        await form.locator('#result').getByText('UNIQUE constraint failed', { exact: false }).waitFor({ timeout: 10000 })
        assert.equal(await form.locator('textarea').nth(1).inputValue(), '{"test":true}')
        const insertTab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((tab) => tab.input?.viewType === 'sqlite3-editor.insert')
        assert.ok(insertTab, 'insert editor is an independent tab')
        assert.equal(insertTab.isDirty, true, 'VS Code tracks unsaved edits')
        await vscode.commands.executeCommand('workbench.action.files.save')
        await form.locator('#result').getByText('草稿已保存', { exact: false }).waitFor({ timeout: 10000 })
        assert.equal(execFileSync('sqlite3', [db, 'SELECT count(*) FROM records'], { encoding: 'utf8' }).trim(), '12')
        assert.equal(insertTab.isDirty, false, 'saving stores a draft and clears VS Code dirty state')
        await form.locator('#cancel').click()
        const closeDeadline = Date.now() + 5000
        while (vscode.window.tabGroups.all.some((group) => group.tabs.includes(insertTab)) && Date.now() < closeDeadline) await new Promise((resolve) => setTimeout(resolve, 50))
        assert.ok(!vscode.window.tabGroups.all.some((group) => group.tabs.includes(insertTab)), 'cancel closes the saved draft tab')
        await table.locator('[data-testid="open-insert-editor"]').click()
        form = await waitFrame('#insert')
        assert.equal(await form.locator('textarea').nth(0).inputValue(), 'existing')
        assert.equal(await form.locator('textarea').nth(1).inputValue(), '{"test":true}')
        await form.locator('.field').nth(1).getByRole('button', { name: '在编辑器中编辑' }).click()
        const textDeadline = Date.now() + 5000
        while (!vscode.window.activeTextEditor && Date.now() < textDeadline) await new Promise((resolve) => setTimeout(resolve, 50))
        const textEditor = vscode.window.activeTextEditor
        assert.ok(textEditor, 'long text opens in the native VS Code editor')
        assert.equal(textEditor.document.languageId, 'json')
        await textEditor.edit((edit) => edit.replace(new vscode.Range(0, 0, textEditor.document.lineCount, 0), '{"test":"native"}'))
        await vscode.commands.executeCommand('vscode.openWith', insertTab.input.uri, 'sqlite3-editor.insert', { viewColumn: insertTab.group.viewColumn, preview: false })
        form = await waitFrame('#insert')
        await form.locator('textarea').nth(1).waitFor()
        assert.equal(await form.locator('textarea').nth(1).inputValue(), '{"test":"native"}')
        const showWarning = vscode.window.showWarningMessage
        let guardCalls = 0
        try {
            vscode.window.showWarningMessage = async () => { guardCalls++; return undefined }
            await table.getByRole('button', { name: 'Next', exact: true }).click()
            const deadline = Date.now() + 5000
            while (!guardCalls && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
            assert.equal(guardCalls, 1, 'page navigation asks about the right-hand draft')
            assert.equal((await table.locator('[data-testid="page-indicator"]').textContent()).trim(), '1 / 2')
            vscode.window.showWarningMessage = async () => 'Keep draft'
            await table.getByRole('button', { name: 'Next', exact: true }).click()
            await table.getByTestId('page-indicator').getByText('2 / 2').waitFor()
            assert.equal(await form.locator('textarea').nth(1).inputValue(), '{"test":"native"}')
        } finally { vscode.window.showWarningMessage = showWarning }
        await form.locator('textarea').nth(0).fill('new-id')
        await form.locator('textarea').nth(1).fill('{"test":true}')
        await form.locator('#insert').click()
        await form.locator('#result').getByText('插入成功', { exact: false }).waitFor({ timeout: 10000 })
        assert.equal(execFileSync('sqlite3', [db, "SELECT payload FROM records WHERE id='new-id'"], { encoding: 'utf8' }).trim(), '{"test":true}')
        assert.equal(await form.locator('#insert').isDisabled(), true)
        await table.getByText('new-id', { exact: true }).waitFor({ timeout: 10000 })
        console.log('HOST PASS right insert form wrote to the bound temporary database')
    } catch (error) {
        console.error('HOST TEST FAILURE', error)
        throw error
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}
