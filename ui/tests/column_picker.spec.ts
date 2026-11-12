import { test, expect } from '@playwright/test'
import { gotoApp, seed } from './helpers'

const seedColumns = async (page: import('@playwright/test').Page) => {
    await gotoApp(page)
    await seed(page, 'column_picker_test', '`id` INT PRIMARY KEY, `name` TEXT, `payload` TEXT, `note` TEXT', ['id', 'name', 'payload', 'note'], [[1, 'first', '{}', 'x']])
    await expect(page.getByTestId('row-count')).toHaveText('1 row')
}

/** Counts the viewer's data requests so a test can prove when the data reloads. */
const countQueries = (page: import('@playwright/test').Page) => {
    const state = { value: 0 }
    page.on('request', (request) => { if (request.url().includes(':8080/query')) { state.value += 1 } })
    return state
}

test('the column picker anchors under the column list and keeps the last column', async ({ page }) => {
    await seedColumns(page)
    const trigger = page.getByTestId('column-picker-trigger')
    const popover = page.getByTestId('column-picker')

    await expect(popover).toHaveCount(0)
    await trigger.click()
    await expect(popover).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(popover.getByText('Visible columns')).toBeVisible()
    await expect(page.getByTestId('column-picker-count')).toHaveText('4 / 4')
    for (const name of ['id', 'name', 'payload', 'note']) {
        await expect(page.getByTestId(`column-picker-item ${name}`)).toBeVisible()
    }
    // The picker does not dim the page like a modal dialog does.
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // Hiding everything but one column is possible...
    await page.getByTestId('column-picker-item name').locator('input').click()
    await page.getByTestId('column-picker-item payload').locator('input').click()
    await page.getByTestId('column-picker-item note').locator('input').click()
    await expect(page.getByTestId('column-picker-count')).toHaveText('1 / 4')
    // ...but the last visible column cannot be hidden.
    await page.getByTestId('column-picker-item id').locator('input').click()
    await expect(page.locator('.column-picker-error')).toContainText('at least one column')
    await expect(page.getByTestId('column-picker-count')).toHaveText('1 / 4')

    // The picker stays open while toggling; Escape discards the draft.
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('thead')).toContainText('name')
})

test('toggling only edits a draft; Enter applies it once', async ({ page }) => {
    await seedColumns(page)
    const queries = countQueries(page)
    const trigger = page.getByTestId('column-picker-trigger')

    await trigger.click()
    await expect(page.getByTestId('column-picker-count')).toHaveText('4 / 4')
    queries.value = 0

    await page.getByTestId('column-picker-item name').locator('input').click()
    await page.getByTestId('column-picker-item payload').locator('input').click()
    await expect(page.getByTestId('column-picker-count')).toHaveText('2 / 4')
    await expect(page.getByTestId('column-picker-pending')).toContainText('applied on Enter')
    // Nothing has been reloaded and the grid still shows the old columns.
    expect(queries.value).toBe(0)
    await expect(page.locator('thead')).toContainText('name')

    await page.getByTestId('column-picker-search').press('Enter')
    await expect(page.getByTestId('column-picker')).toHaveCount(0)
    await expect(page.locator('thead')).not.toContainText('name')
    await expect(page.locator('thead')).toContainText('id')
    // One applied change costs one reload, not one per checkbox.
    await expect.poll(() => queries.value).toBeGreaterThan(0)
    await expect.poll(() => queries.value).toBeLessThanOrEqual(2)
})

test('Escape and outside clicks discard the draft', async ({ page }) => {
    await seedColumns(page)
    const trigger = page.getByTestId('column-picker-trigger')

    await trigger.click()
    await page.getByTestId('column-picker-item name').locator('input').click()
    await page.getByTestId('column-picker-search').press('Escape')
    await expect(page.getByTestId('column-picker')).toHaveCount(0)
    await expect(page.locator('thead')).toContainText('name')

    await trigger.click()
    await page.getByTestId('column-picker-item name').locator('input').click()
    await page.getByTestId('row-count').click()
    await expect(page.getByTestId('column-picker')).toHaveCount(0)
    await expect(page.locator('thead')).toContainText('name')
})

test('the search filters column names fuzzily', async ({ page }) => {
    await seedColumns(page)
    await page.getByTestId('column-picker-trigger').click()
    const search = page.getByTestId('column-picker-search')
    await expect(search).toBeFocused()

    // A subsequence is enough: `nt` finds `note`.
    await search.fill('nt')
    await expect(page.locator('.column-picker-item')).toHaveCount(1)
    await expect(page.getByTestId('column-picker-item note')).toBeVisible()
    await expect(page.getByTestId('column-picker-item note').locator('mark')).toHaveCount(2)

    // A prefix keeps the column list short and the bulk actions follow the filter.
    await search.fill('pa')
    await expect(page.getByTestId('column-picker-select-all')).toHaveText('Select 1 match')

    // No match shows a hint instead of an empty list.
    await search.fill('zzz')
    await expect(page.getByTestId('column-picker-no-match')).toBeVisible()
    await expect(page.locator('.column-picker-item')).toHaveCount(0)

    // Clearing the field restores every row.
    await page.getByTestId('column-picker-search-clear').click()
    await expect(search).toHaveValue('')
    await expect(page.locator('.column-picker-item')).toHaveCount(4)
})

test('bulk actions apply to the matches while a filter is active', async ({ page }) => {
    await seedColumns(page)
    const trigger = page.getByTestId('column-picker-trigger')
    const count = page.getByTestId('column-picker-count')
    await trigger.click()
    await expect(count).toHaveText('4 / 4')

    // Clear all without a filter leaves exactly one column.
    await page.getByTestId('column-picker-clear-all').click()
    await expect(count).toHaveText('1 / 4')

    // Filter to one column and select only that one.
    await page.getByTestId('column-picker-search').fill('pa')
    await page.getByTestId('column-picker-select-all').click()
    await expect(count).toHaveText('2 / 4')

    // Clearing the matches keeps the columns outside the filter.
    await page.getByTestId('column-picker-clear-all').click()
    await expect(count).toHaveText('1 / 4')

    // Select all with no filter brings everything back, and Enter applies it.
    await page.getByTestId('column-picker-search-clear').click()
    await page.getByTestId('column-picker-select-all').click()
    await expect(count).toHaveText('4 / 4')
    await page.getByTestId('column-picker-search').press('Enter')
    await expect(page.locator('thead')).toContainText('note')
    await expect(page.locator('thead')).toContainText('payload')
})

test('Space toggles the highlighted column and Enter applies', async ({ page }) => {
    await seedColumns(page)
    const trigger = page.getByTestId('column-picker-trigger')
    await trigger.click()
    const search = page.getByTestId('column-picker-search')

    // The first row is highlighted; Space toggles it without closing.
    await expect(page.getByTestId('column-picker-item id')).toHaveAttribute('data-cursor', 'true')
    await search.press('Space')
    await expect(page.getByTestId('column-picker-count')).toHaveText('3 / 4')
    await expect(page.getByTestId('column-picker')).toBeVisible()

    // Arrow keys move the highlight; Space toggles the new row both ways.
    await search.press('ArrowDown')
    await expect(page.getByTestId('column-picker-item name')).toHaveAttribute('data-cursor', 'true')
    await search.press('Space')
    await expect(page.getByTestId('column-picker-count')).toHaveText('2 / 4')
    await search.press('Space')
    await expect(page.getByTestId('column-picker-count')).toHaveText('3 / 4')

    // Enter applies the draft and closes.
    await search.press('Enter')
    await expect(page.getByTestId('column-picker')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('thead')).not.toContainText('id')
})

test('Escape clears the filter first, then discards', async ({ page }) => {
    await seedColumns(page)
    await page.getByTestId('column-picker-trigger').click()
    const search = page.getByTestId('column-picker-search')
    await search.fill('pa')
    await expect(page.locator('.column-picker-item')).toHaveCount(1)

    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.locator('.column-picker-item')).toHaveCount(4)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('column-picker')).toHaveCount(0)
})

test('the picker closes on an outside click and after a table change', async ({ page }) => {
    await seedColumns(page)
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

test('the fuzzy matcher ranks prefixes first and returns the matched characters', async ({ page }) => {
    await gotoApp(page)
    const result = await page.evaluate(async () => {
        const fuzzy = await (new Function('return import("/fuzzy.ts")'))()
        const names = ['id', 'payload', 'seq', 'g_cid', 'g_session_id', 'g_status', 'projection_source_hash', 'projection_ready']
        return {
            subsequence: fuzzy.fuzzyMatch('projection_source_hash', 'psh'),
            noMatch: fuzzy.fuzzyMatch('payload', 'zzz'),
            misses: fuzzy.fuzzyMatch('abc', 'cab'),
            prefixFirst: fuzzy.fuzzyFilter(names.map((name) => ({ name })), 'pay').map((row: { name: string }) => row.name),
            fuzzyRanked: fuzzy.fuzzyFilter(names.map((name) => ({ name })), 'projread').map((row: { name: string }) => row.name),
            keepsOrder: fuzzy.fuzzyFilter(names.map((name) => ({ name })), '').map((row: { name: string }) => row.name),
            caseInsensitive: fuzzy.fuzzyMatch('G_STATUS', 'gs'),
        }
    })
    expect(result.subsequence.hits).toEqual([0, 11, 18])
    expect(result.noMatch).toBeNull()
    expect(result.misses).toBeNull()
    // `pay` is also a subsequence of `projection_ready`, but the prefix match ranks first.
    expect(result.prefixFirst).toEqual(['payload', 'projection_ready'])
    expect(result.fuzzyRanked).toEqual(['projection_ready'])
    expect(result.keepsOrder).toEqual(['id', 'payload', 'seq', 'g_cid', 'g_session_id', 'g_status', 'projection_source_hash', 'projection_ready'])
    expect(result.caseInsensitive.hits).toEqual([0, 2])
})
