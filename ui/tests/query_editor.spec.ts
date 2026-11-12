import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers'

test('the query editor runs read-only statements and opens and saves files', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('query-editor-toggle').click()
    const editor = page.getByTestId('query-editor')
    await editor.getByTestId('query-editor-sql').fill('SELECT 42 AS answer')
    await editor.getByRole('button', { name: 'Run read-only' }).click()
    await expect(editor.getByRole('status')).toHaveText('1 row(s).')
    await expect(editor.getByRole('cell', { name: '42' })).toBeVisible()

    // The document survives a round trip through the toggle.
    await page.getByTestId('query-editor-toggle').click()
    await page.getByTestId('query-editor-toggle').click()
    await expect(editor.getByTestId('query-editor-sql')).toHaveValue('SELECT 42 AS answer')

    // Ctrl+Enter runs the statement as well.
    await editor.getByTestId('query-editor-sql').press('Control+Enter')
    await expect(editor.getByRole('status')).toHaveText('1 row(s).')

    // Write statements are refused and reported in place.
    await editor.getByTestId('query-editor-sql').fill('CREATE TABLE IF NOT EXISTS query_editor_test (value TEXT)')
    await editor.getByRole('button', { name: 'Run read-only' }).click()
    await expect(editor.getByRole('status')).toContainText(/read-only/i)

    const downloadPromise = page.waitForEvent('download')
    await editor.getByRole('button', { name: 'Save as…' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('query.sql')

    page.once('dialog', (dialog) => dialog.accept())
    const chooserPromise = page.waitForEvent('filechooser')
    await editor.getByRole('button', { name: 'Open…' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({ name: 'opened.sql', mimeType: 'text/sql', buffer: Buffer.from('SELECT 99 AS opened') })
    await expect(editor.getByTestId('query-editor-sql')).toHaveValue('SELECT 99 AS opened')
})
