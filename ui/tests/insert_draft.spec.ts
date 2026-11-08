import { test, expect } from '@playwright/test'

test('a failed insert preserves the entered draft for correction', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query('CREATE TABLE IF NOT EXISTS insert_draft_test (id TEXT PRIMARY KEY, value TEXT)', [], 'w+')
        await remote.query('CREATE TABLE IF NOT EXISTS insert_draft_other (id TEXT)', [], 'w+')
        await remote.query('DELETE FROM insert_draft_test', [], 'w+')
        await remote.query("INSERT INTO insert_draft_test VALUES ('existing', 'old')", [], 'w+')
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('insert_draft_test')
        await table.getState().setViewerQuery({ tableName: 'insert_draft_test' })
    })
    const id = page.getByTestId('insert-column 1').getByTestId('editor-textarea')
    const value = page.getByTestId('insert-column 2').getByTestId('editor-textarea')
    await id.fill('existing')
    await value.fill('draft value')
    await page.getByTestId('commit').click()
    await expect(page.getByText(/UNIQUE constraint failed/)).toBeVisible()
    await expect(id).toHaveValue('existing')
    await expect(value).toHaveValue('draft value')
    await page.getByTestId('table-name').click()
    await page.getByRole('option', { name: /insert_draft_other/ }).click()
    await page.getByTestId('dialog > cancel').click()
    await expect(page.getByTestId('table-name')).toContainText('insert_draft_test')
    await expect(value).toHaveValue('draft value')
})
