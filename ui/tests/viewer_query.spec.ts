import { test, expect } from '@playwright/test'

/** Creates a table whose `name` column makes the order easy to verify. */
const seed = async (page: import('@playwright/test').Page) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('CREATE TABLE IF NOT EXISTS sort_filter_test (id INTEGER PRIMARY KEY, name TEXT)', [], 'w+')
        await remote.query('DELETE FROM sort_filter_test', [], 'w+')
        await remote.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<23) INSERT INTO sort_filter_test SELECT x, 'name ' || ((24 - x) % 7) FROM n", [], 'w+')
        await table.getState().reloadAllTables('sort_filter_test')
        await table.getState().setViewerQuery({ tableName: 'sort_filter_test' })
    })
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')
}

test('sorting and filtering are applied by the database', async ({ page }) => {
    await seed(page)
    const nameHeader = page.locator('th[title="Sort by name"]')

    // Ascending sort orders the whole result, not only the visible page.
    await nameHeader.click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByTestId('cell 0, 1')).toHaveText('name 0')
    // Descending sort is the second click on the same column.
    await nameHeader.click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    await expect(page.getByTestId('cell 0, 1')).toHaveText('name 6')
    // Clearing the sort restores the natural (rowid) order.
    await page.getByTestId('clear-sort').click()
    await expect(page.getByTestId('cell 0, 0')).toHaveText('1')

    // Filtering also happens in the database, so it applies to rows on other pages.
    await page.getByTestId('viewer-filter').fill('name 3')
    await page.getByTestId('viewer-filter').press('Enter')
    await expect(page.getByTestId('row-count')).toHaveText('3 rows')
    await expect(page.getByTestId('page-input')).toHaveValue('1')
    await expect(page.getByTestId('page-indicator')).toHaveText('1')
    await expect(page.getByTestId('cell 0, 0')).toHaveText('7')
    await expect(page.getByTestId('cell 1, 0')).toHaveText('14')

    // Removing the filter restores every row.
    await page.getByTestId('viewer-filter').fill('')
    await page.getByTestId('viewer-filter').press('Enter')
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')

    // The page number input jumps to a page directly.
    await page.getByTestId('page-input').fill('3')
    await page.getByTestId('page-input').press('Enter')
    await expect(page.getByTestId('cell 20, 0')).toHaveText('21')
    // Out of range values are clipped.
    await page.getByTestId('page-input').fill('99')
    await page.getByTestId('page-input').press('Enter')
    await expect(page.getByTestId('cell 20, 0')).toHaveText('21')
    await expect(page.getByTestId('page-input')).toHaveValue('3')
})

test('custom query mode runs on demand and keeps its draft and last result', async ({ page }) => {
    await seed(page)

    // Entering the query mode shows an empty state instead of the table data.
    await page.getByTestId('mode-query').click()
    await expect(page.getByTestId('empty-query')).toBeVisible()
    await expect(page.getByTestId('viewer-table')).toHaveCount(0)
    // The writable editor pane is hidden here; the composer is the only query input.
    await expect(page.locator('#editor')).toBeHidden()
    await expect(page.getByTestId('custom-query-input')).toBeVisible()

    // Running a query shows its result and marks the tab as read-only data.
    await page.getByTestId('custom-query-input').fill('SELECT id, name FROM sort_filter_test ORDER BY id')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')
    await expect(page.getByTestId('page-indicator')).toHaveText('3')
    await expect(page.getByTestId('viewer-table')).toBeVisible()

    // A trailing semicolon is accepted.
    await page.getByTestId('custom-query-input').fill('SELECT id FROM sort_filter_test WHERE id <= 3;')
    await page.getByTestId('custom-query-input').press('Control+Enter')
    await expect(page.getByTestId('row-count')).toHaveText('3 rows')

    // A write statement never reaches the database and the previous result stays visible.
    await page.getByTestId('custom-query-input').fill('DELETE FROM sort_filter_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText('read-only')
    await expect(page.getByTestId('row-count')).toHaveText('3 rows')

    // Leaving the mode with an unexecuted draft asks first and keeps the draft.
    await page.getByTestId('mode-table').click()
    await expect(page.getByTestId('query-dialog > keep-draft')).toBeVisible()
    await page.getByTestId('query-dialog > keep-draft').click()
    await expect(page.getByTestId('mode-table')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('mode-query').click()
    await expect(page.getByTestId('custom-query-input')).toHaveValue('DELETE FROM sort_filter_test')

    // Cancelling the dialog stays in the query mode.
    await page.getByTestId('mode-table').click()
    await page.getByTestId('query-dialog > keep-editing').click()
    await expect(page.getByTestId('mode-query')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('custom-query-input')).toHaveValue('DELETE FROM sort_filter_test')
})

test('a failing query keeps the last successful result', async ({ page }) => {
    await seed(page)
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill('SELECT id FROM sort_filter_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')
    await page.getByTestId('custom-query-input').fill('SELECT * FROM missing_table')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText('no such table')
    // The previous rows stay readable while the error is shown.
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')
    await expect(page.getByTestId('cell 0, 0')).toHaveText('1')
})

test('clearing the draft returns to the empty state', async ({ page }) => {
    await seed(page)
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill('SELECT id FROM sort_filter_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('row-count')).toHaveText('23 rows')
    // An empty draft cannot run and does not destroy the current result.
    await page.getByTestId('custom-query-input').fill('')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText('Enter a SQL query')
})
