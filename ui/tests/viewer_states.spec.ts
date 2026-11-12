import { test, expect } from '@playwright/test'
import { gotoApp, numberedRows, seed } from './helpers'

const seedStates = async (page: import('@playwright/test').Page) => {
    await gotoApp(page)
    await seed(page, 'viewer_states_test', '`id` INT PRIMARY KEY, `name` TEXT', ['id', 'name'], numberedRows(12, (i) => `n${i}`))
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
}

test('loading state shows progress and blocks pagination', async ({ page }) => {
    await seedStates(page)
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
    await seedStates(page)
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill('SELECT id FROM viewer_states_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
    await expect(page.getByText('Showing the last successful result')).toHaveCount(0)
    await page.getByTestId('custom-query-input').fill('SELECT * FROM missing_table')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText("doesn't exist")
    await expect(page.getByText('Showing the last successful result')).toBeVisible()
    // A successful run clears the marker.
    await page.getByTestId('custom-query-input').fill('SELECT id FROM viewer_states_test')
    await page.getByTestId('run-query').click()
    await expect(page.getByText('Showing the last successful result')).toHaveCount(0)
})

test('hiding the sorted column clears the sort', async ({ page }) => {
    await seedStates(page)
    const nameHeader = page.locator('th[title="Sort by name"]')
    await nameHeader.click()
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByTestId('clear-sort')).toBeVisible()
    await nameHeader.click({ button: 'right' })
    await page.getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(page.locator('thead')).not.toContainText('name')
    await expect(page.getByTestId('clear-sort')).toHaveCount(0)
    await expect(page.locator('th[aria-sort]')).toHaveCount(0)
})

test('refresh picks up rows written by another client', async ({ page }) => {
    await seedStates(page)
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.post('/test/execute', { query: "INSERT INTO viewer_states_test VALUES (13, 'external')" })
    })
    // Nothing polls: the count stays until the user asks for a refresh.
    await expect(page.getByTestId('row-count')).toHaveText('12 rows')
    await page.getByTestId('refresh').click()
    await expect(page.getByTestId('row-count')).toHaveText('13 rows')
})

test('the query mode can be seeded from the more actions menu without running', async ({ page }) => {
    await seedStates(page)
    await page.getByText('More actions').click()
    await page.getByRole('button', { name: 'Describe Columns in Query Mode', exact: true }).click()
    await expect(page.getByTestId('mode-query')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('custom-query-input')).toHaveValue(/information_schema\.COLUMNS/)
    // Nothing ran yet: the data area is still empty for this mode.
    await expect(page.getByTestId('empty-query')).toBeVisible()
    await expect(page.getByTestId('viewer-table')).toHaveCount(0)
})
