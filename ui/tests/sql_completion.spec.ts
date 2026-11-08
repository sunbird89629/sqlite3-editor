import { test, expect } from '@playwright/test'

const seed = async (page: import('@playwright/test').Page) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('CREATE TABLE IF NOT EXISTS completion_test (id INTEGER PRIMARY KEY, payload TEXT, created_at TEXT)', [], 'w+')
        await remote.query('DELETE FROM completion_test', [], 'w+')
        await remote.query("INSERT INTO completion_test VALUES (1, 'x', '2020-01-01')", [], 'w+')
        await table.getState().reloadAllTables('completion_test')
        await table.getState().setViewerQuery({ tableName: 'completion_test' })
    })
    await page.getByTestId('mode-query').click()
    await expect(page.getByTestId('custom-query-input')).toBeVisible()
}

test('keywords are completed while typing', async ({ page }) => {
    await seed(page)
    const input = page.getByTestId('custom-query-input')
    await input.fill('WHER')
    const list = page.getByTestId('sql-completion')
    await expect(list).toBeVisible()
    await expect(list.getByRole('option', { name: /WHERE/ })).toBeVisible()
    await input.press('Enter')
    await expect(input).toHaveValue('WHERE')
    await expect(list).toHaveCount(0)
})

test('table names and columns of referenced tables are completed', async ({ page }) => {
    await seed(page)
    const input = page.getByTestId('custom-query-input')
    const list = page.getByTestId('sql-completion')

    // Table names come from the loaded table list.
    await input.fill('SELECT * FROM completion')
    await expect(input).toHaveValue('SELECT * FROM completion')
    await expect(list.getByRole('option', { name: /completion_test/ })).toBeVisible()
    await input.press('Enter')
    await expect(input).toHaveValue('SELECT * FROM completion_test')

    // Columns of the table named in the statement are suggested after the caret.
    await input.fill('SELECT * FROM completion_test WHERE cre')
    await expect(list.getByRole('option', { name: /created_at/ })).toBeVisible()
    await input.press('Enter')
    await expect(input).toHaveValue('SELECT * FROM completion_test WHERE created_at')
})

test('typing filters the list, Escape leaves the text and Tab inserts', async ({ page }) => {
    await seed(page)
    const input = page.getByTestId('custom-query-input')
    const list = page.getByTestId('sql-completion')

    // Escape closes the popup without changing what was typed.
    await input.fill('SELECT * FROM completion_test WHERE ')
    for (const char of ["c", "r", "e"]) { await input.press(char) }
    await expect(list).toBeVisible()
    await input.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(input).toHaveValue('SELECT * FROM completion_test WHERE cre')

    // Typing narrows to one candidate, and Tab accepts it.
    for (const char of ["a", "t", "e", "d"]) { await input.press(char) }
    await expect(list).toBeVisible()
    await expect(list.getByRole('option')).toHaveCount(1)
    await input.press('Tab')
    await expect(input).toHaveValue('SELECT * FROM completion_test WHERE created_at')
    await expect(list).toHaveCount(0)
})
