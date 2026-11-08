import { test, expect } from '@playwright/test'

const seed = async (page: import('@playwright/test').Page) => {
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('CREATE TABLE IF NOT EXISTS column_picker_test (id INTEGER PRIMARY KEY, name TEXT, payload TEXT)', [], 'w+')
        await remote.query('DELETE FROM column_picker_test', [], 'w+')
        await remote.query("INSERT INTO column_picker_test VALUES (1, 'first', '{}')", [], 'w+')
        await table.getState().reloadAllTables('column_picker_test')
        await table.getState().setViewerQuery({ tableName: 'column_picker_test' })
    })
    await expect(page.getByTestId('row-count')).toHaveText('1 row')
}

test('the column picker anchors under the column list and toggles columns', async ({ page }) => {
    await seed(page)
    const trigger = page.getByTestId('column-picker-trigger')
    const popover = page.getByTestId('column-picker')

    await expect(popover).toHaveCount(0)
    await trigger.click()
    await expect(popover).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(popover.getByText('Visible columns')).toBeVisible()
    for (const name of ['id', 'name', 'payload']) {
        await expect(page.getByTestId(`column-picker-item ${name}`)).toBeVisible()
    }
    // The picker does not dim the page like a modal dialog does.
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // Hiding a column removes it from the viewer header.
    await page.getByTestId('column-picker-item name').locator('input').uncheck()
    await expect(page.locator('thead')).not.toContainText('name')
    await expect(page.locator('thead')).toContainText('payload')
    // The picker stays open so that several columns can be toggled.
    await expect(popover).toBeVisible()

    // Hiding everything but one column is possible...
    await page.getByTestId('column-picker-item payload').locator('input').uncheck()
    await expect(page.locator('thead')).not.toContainText('payload')
    // ...but the last visible column cannot be hidden.
    // A plain click (not `uncheck`, which asserts a state change) hits the guard.
    await page.getByTestId('column-picker-item id').locator('input').click()
    await expect(page.locator('.column-picker-error')).toContainText('at least one column')
    await expect(page.locator('thead')).toContainText('id')

    // Re-enabling columns restores them.
    await page.getByTestId('column-picker-item name').locator('input').check()
    await page.getByTestId('column-picker-item payload').locator('input').check()
    await expect(page.locator('thead')).toContainText('name')
    await expect(page.locator('thead')).toContainText('payload')

    // Escape closes the picker and returns focus to the trigger.
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

test('the column picker closes on an outside click and after a table change', async ({ page }) => {
    await seed(page)
    const trigger = page.getByTestId('column-picker-trigger')
    const popover = page.getByTestId('column-picker')

    await trigger.click()
    await expect(popover).toBeVisible()
    // Clicking inside the popover keeps it open.
    await page.getByTestId('column-picker-item id').click()
    await expect(popover).toBeVisible()
    // Clicking outside closes it.
    await page.getByTestId('row-count').click()
    await expect(popover).toHaveCount(0)

    await trigger.click()
    await expect(popover).toBeVisible()
    await page.getByTestId('mode-query').click()
    await page.getByTestId('mode-table').click()
    await expect(popover).toHaveCount(0)
})
