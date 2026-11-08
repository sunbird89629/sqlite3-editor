import { test, expect } from '@playwright/test'

const seed = async (page: import('@playwright/test').Page) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('CREATE TABLE IF NOT EXISTS selection_test (id INTEGER PRIMARY KEY, name TEXT)', [], 'w+')
        await remote.query('DELETE FROM selection_test', [], 'w+')
        await remote.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12) INSERT INTO selection_test SELECT x, 'n' || x FROM n", [], 'w+')
        await table.getState().reloadAllTables('selection_test')
        await table.getState().setViewerQuery({ tableName: 'selection_test' })
    })
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
}

test('the first click selects a cell and the second starts editing', async ({ page }) => {
    await seed(page)
    const cell = page.getByTestId('cell 0, 1')
    await cell.click()
    // Selected, but not editable yet.
    await expect(cell).toHaveAttribute('data-cell-selected', 'true')
    await expect(page.getByTestId('inplaceInput')).toHaveCount(0)
    // Escape clears the selection.
    await page.keyboard.press('Escape')
    await expect(page.locator('td[data-cell-selected="true"]')).toHaveCount(0)
    // A second click on the same cell starts editing.
    await cell.click()
    await cell.click()
    await expect(page.getByTestId('inplaceInput')).toBeVisible()
    await expect(page.getByTestId('UPDATE')).toBeVisible()
})

test('Enter on a selected cell starts editing', async ({ page }) => {
    await seed(page)
    const cell = page.getByTestId('cell 0, 1')
    await cell.click()
    await expect(page.getByTestId('inplaceInput')).toHaveCount(0)
    await cell.press('Enter')
    await expect(page.getByTestId('inplaceInput')).toBeVisible()
    await expect(page.getByTestId('UPDATE')).toBeVisible()
})

test('arrow keys move the selection across cells and pages', async ({ page }) => {
    await seed(page)
    await page.getByTestId('cell 0, 0').click()
    await expect(page.getByTestId('cell 0, 0')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('cell 1, 1')).toHaveAttribute('data-cell-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    // Moving up from the first row goes to the previous page (none here), so it stays.
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('cell 0, 1')).toHaveAttribute('data-cell-selected', 'true')
    // Moving down past the last visible row turns the page and selects its first row.
    for (let i = 0; i < 11; i++) { await page.keyboard.press('ArrowDown') }
    await expect(page.getByTestId('page-input')).toHaveValue('2')
    await expect(page.locator('td[data-cell-selected="true"]')).toHaveCount(1)
})

test('cancelling a cell edit collapses the editor instead of showing the insert form', async ({ page }) => {
    await seed(page)
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('inplaceInput').fill('draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('td[data-cell-selected="true"]')).toHaveCount(0)
    const toggle = page.getByTestId('editor-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // The insert form is not shown until the pane is expanded again.
    await expect(page.getByTestId('insert-column 1')).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('insert-column 1')).toBeVisible()
})

test('a successful commit shows a save confirmation', async ({ page }) => {
    await seed(page)
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('inplaceInput').fill('saved value')
    await page.getByTestId('commit').click()
    await expect(page.getByTestId('editor-status')).toHaveText('Saved')
    await expect(page.getByTestId('cell 0, 1')).toContainText('saved value')
})

test('the value type control is a radio group', async ({ page }) => {
    await seed(page)
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('cell 0, 1').click()
    const group = page.getByRole('radiogroup', { name: 'Value type' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('radio')).toHaveCount(5)
    await group.getByRole('radio', { name: 'NULL' }).check()
    await expect(group.getByRole('radio', { name: 'NULL' })).toBeChecked()
    await expect(group.getByRole('radio', { name: 'TEXT' })).not.toBeChecked()
})
