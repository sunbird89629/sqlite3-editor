import { test, expect } from '@playwright/test'
import { exec, gotoApp } from './helpers'

const BIG = 300_000

/** Creates a table whose long column holds BIG characters per row. */
const seedLarge = async (page: import('@playwright/test').Page) => {
    await exec(page, 'DROP TABLE IF EXISTS large_text_test')
    await exec(page, 'CREATE TABLE large_text_test (`id` INT PRIMARY KEY, `payload` LONGTEXT NOT NULL)')
    await exec(page, 'INSERT INTO large_text_test VALUES (1, ?), (2, ?)', ['x'.repeat(BIG), 'y'.repeat(BIG)])
}

/** Loads a table into the viewer after its fixtures exist. */
const show = async (page: import('@playwright/test').Page, table: string) => {
    await page.evaluate(async (name) => {
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables(name)
        await table.getState().setViewerQuery({ tableName: name })
    }, table)
}

test('a long text column is read as a prefix and fetched in full on demand', async ({ page }) => {
    await gotoApp(page)
    await seedLarge(page)
    await show(page, 'large_text_test')
    await expect(page.getByTestId('row-count')).toHaveText('2 rows')

    // The page query sends LEFT(payload, 1024): a full value would dominate the request.
    const lengths = await page.evaluate(() => (window as any).useTableStore.getState().records.map((record: Record<string, string>) => record.payload!.length))
    expect(lengths).toEqual([1024, 1024])
    expect(await page.evaluate(() => (window as any).useTableStore.getState().truncatedColumns)).toContain('payload')

    // The preview stays bounded in the grid.
    const shown = await page.getByTestId('cell 0, 1').innerText()
    expect(shown.length).toBeLessThan(600)
    expect(shown.endsWith('…')).toBe(true)

    // Double click reads the whole value for the snapshot.
    const popup = page.waitForEvent('popup')
    await page.getByTestId('cell 0, 1').dblclick()
    const opened = await popup
    await opened.waitForLoadState()
    const text = await opened.evaluate(() => document.body.innerText)
    expect(text.length).toBe(BIG)
    expect(text.startsWith('x')).toBe(true)
})

test('the row snapshot also reads long values in full', async ({ page }) => {
    await gotoApp(page)
    await seedLarge(page)
    await show(page, 'large_text_test')

    const popup = page.waitForEvent('popup')
    await page.getByTestId('row number 1').click()
    const opened = await popup
    await opened.waitForLoadState()
    const text = await opened.evaluate(() => document.body.innerText)
    // The JSON snapshot carries the whole value, not the 1024-character page prefix.
    expect(text.length).toBeGreaterThan(BIG)
    expect(text).toContain('x'.repeat(1000))
})

test('a table without a row key still resolves the value by page offset', async ({ page }) => {
    await gotoApp(page)
    await exec(page, 'DROP TABLE IF EXISTS large_text_nopk')
    await exec(page, 'CREATE TABLE large_text_nopk (`v` LONGTEXT NOT NULL)')
    await exec(page, 'INSERT INTO large_text_nopk VALUES (?), (?)', ['a'.repeat(BIG), 'b'.repeat(BIG)])
    await show(page, 'large_text_nopk')
    await expect(page.getByTestId('row-count')).toHaveText('2 rows')

    const popup = page.waitForEvent('popup')
    await page.getByTestId('cell 0, 0').dblclick()
    const opened = await popup
    await opened.waitForLoadState()
    expect((await opened.evaluate(() => document.body.innerText)).length).toBe(BIG)
})
