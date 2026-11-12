import { test, expect } from '@playwright/test'
import { exec, gotoApp } from './helpers'

test('searches tables, supports keyboard selection, and stays within a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 500 })
    await gotoApp(page)
    for (const name of ['selector_alpha', 'selector_beta', 'selector_gamma']) {
        await exec(page, `CREATE TABLE IF NOT EXISTS \`${name}\` (value TEXT)`)
    }
    await page.evaluate(async () => {
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('selector_alpha')
        await table.getState().setViewerQuery({ tableName: 'selector_alpha' })
    })
    await page.getByTestId('table-name').click()
    const search = page.getByRole('combobox', { name: 'Search tables or views' })
    await expect(search).toBeFocused()
    await search.fill('selector_')
    await expect(page.getByRole('option')).toHaveCount(3)
    const box = await page.getByRole('listbox').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(420)
    expect(box!.y + box!.height).toBeLessThanOrEqual(500)
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(page.getByTestId('table-name')).toContainText('selector_beta')
    await expect(page.getByTestId('table-name')).toBeFocused()
    await page.getByTestId('table-name').click()
    await search.fill('no such table')
    await expect(page.getByText('No matching tables or views')).toBeVisible()
    await search.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.getByTestId('table-name')).toBeFocused()
})
