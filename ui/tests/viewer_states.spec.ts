import { test, expect } from '@playwright/test'

const seed = async (page: import('@playwright/test').Page) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('CREATE TABLE IF NOT EXISTS viewer_states_test (id INTEGER PRIMARY KEY, name TEXT)', [], 'w+')
        await remote.query('DELETE FROM viewer_states_test', [], 'w+')
        await remote.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<12) INSERT INTO viewer_states_test SELECT x, 'n' || x FROM n", [], 'w+')
        await table.getState().reloadAllTables('viewer_states_test')
        await table.getState().setViewerQuery({ tableName: 'viewer_states_test' })
    })
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
}

test('loading state shows progress and blocks pagination', async ({ page }) => {
    await seed(page)
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await expect(next).toBeEnabled()
    await page.evaluate(() => (window as any).useTableStore.setState({ viewerLoading: true }))
    await expect(page.getByText('Loading…')).toBeVisible()
    await expect(page.getByTestId('page-input')).toBeDisabled()
    await expect(next).toBeDisabled()
    await expect(page.getByTestId('viewer-table')).toHaveAttribute('aria-busy', 'true')
    await page.evaluate(() => (window as any).useTableStore.setState({ viewerLoading: false }))
    await expect(page.getByText('Loading…')).toHaveCount(0)
    await expect(next).toBeEnabled()
})

test('a failed query marks the rows as the previous result', async ({ page }) => {
    await seed(page)
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill('SELECT id FROM viewer_states_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
    await expect(page.getByText('Showing the last successful result')).toHaveCount(0)
    await page.getByTestId('custom-query-input').fill('SELECT * FROM missing_table')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText('no such table')
    await expect(page.getByText('Showing the last successful result')).toBeVisible()
    // A successful run clears the marker.
    await page.getByTestId('custom-query-input').fill('SELECT id FROM viewer_states_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByText('Showing the last successful result')).toHaveCount(0)
})

test('hiding the sorted column clears the sort', async ({ page }) => {
    await seed(page)
    const nameHeader = page.locator('th[title="Sort by name"]')
    await nameHeader.click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByTestId('clear-sort')).toBeVisible()
    // Hide the sorted column from its header context menu.
    await nameHeader.click({ button: 'right' })
    await page.getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(page.locator('thead')).not.toContainText('name')
    await expect(page.getByTestId('clear-sort')).toHaveCount(0)
    await expect(page.locator('th[aria-sort]')).toHaveCount(0)
})

test('Check Journal Mode fills the query editor without running it', async ({ page }) => {
    await seed(page)
    await page.getByText('More actions').click()
    await page.getByRole('button', { name: 'Check Journal Mode', exact: true }).click()
    await expect(page.getByTestId('mode-query')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('custom-query-input')).toHaveValue('SELECT * FROM pragma_journal_mode')
    // Nothing ran yet: the data area is still empty for this mode.
    await expect(page.getByTestId('empty-query')).toBeVisible()
    await expect(page.getByTestId('viewer-table')).toHaveCount(0)
})

test('external changes wait for an unsaved edit instead of replacing it', async ({ page }) => {
    await seed(page)
    await page.evaluate(async () => {
        const table = (window as any).useTableStore
        table.setState({ autoReload: true })
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query("UPDATE viewer_states_test SET name = 'external' WHERE id = 1", [], 'w+')
        table.setState({ reloadRequired: true })
    })
    // The automatic reload replaces the rows when nothing is being edited.
    await expect(page.getByTestId('cell 0, 1')).toContainText('external')
    await expect(page.getByTestId('reload-external')).toHaveCount(0)

    // With an unsaved edit the rows stay put and the notice stays visible.
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('cell 0, 1').click()
    await page.getByTestId('inplaceInput').fill('draft')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query("UPDATE viewer_states_test SET name = 'second' WHERE id = 2", [], 'w+')
        ;(window as any).useTableStore.setState({ reloadRequired: true, autoReload: true })
    })
    await expect(page.getByTestId('reload-external')).toBeVisible()
    await expect(page.getByTestId('inplaceInput')).toHaveValue('draft')
    await expect(page.getByTestId('cell 0, 1')).not.toContainText('second')
    // Finishing the edit lets the pending reload run.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByTestId('cell 1, 1')).toContainText('second')
    await expect(page.getByTestId('reload-external')).toHaveCount(0)
})
