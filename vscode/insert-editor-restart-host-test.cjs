const vscode = require('vscode')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { chromium } = require('@playwright/test')
exports.run = async () => {
    try {
        await vscode.extensions.getExtension('yy0931.vscode-sqlite3-editor').activate()
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(process.env.INSERT_TEST_DB), 'sqlite3-editor.editor')
        const browser = await chromium.connectOverCDP('http://127.0.0.1:' + process.env.INSERT_TEST_CDP_PORT)
        const waitFrame = async (selector) => {
            const deadline = Date.now() + 20000
            while (Date.now() < deadline) {
                for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames()) {
                    try { if (await frame.locator(selector).count()) return frame } catch {}
                }
                await new Promise((resolve) => setTimeout(resolve, 150))
            }
            throw new Error('Missing frame: ' + selector)
        }
        const table = await waitFrame('[data-testid="open-insert-editor"]')
        await table.locator('[data-testid="open-insert-editor"]').click()
        const form = await waitFrame('#insert')
        if (process.env.INSERT_TEST_PHASE === 'save') {
            await form.locator('select').nth(0).selectOption('string')
            await form.locator('textarea').nth(0).fill('restart-id')
            await form.locator('select').nth(1).selectOption('string')
            await form.locator('textarea').nth(1).fill('restored-value')
            await vscode.commands.executeCommand('workbench.action.files.save')
            await form.locator('#result').getByText('草稿已保存', { exact: false }).waitFor({ timeout: 10000 })
            await form.locator('#cancel').click()
            console.log('RESTART PHASE saved draft')
        } else {
            assert.equal(await form.locator('textarea').nth(0).inputValue(), 'restart-id')
            assert.equal(await form.locator('textarea').nth(1).inputValue(), 'restored-value')
            await form.locator('#insert').click()
            await form.locator('#result').getByText('插入成功', { exact: false }).waitFor({ timeout: 10000 })
            assert.equal(execFileSync('sqlite3', [process.env.INSERT_TEST_DB, "SELECT payload FROM records WHERE id='restart-id'"], { encoding: 'utf8' }).trim(), 'restored-value')
            console.log('RESTART PHASE restored and inserted draft')
        }
    } catch (error) { console.error('RESTART TEST FAILURE', error); throw error }
}
