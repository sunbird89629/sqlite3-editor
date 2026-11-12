import { test, expect } from '@playwright/test'
import { gotoApp, seed } from './helpers'

/** The development server keeps the workspace state between tests, so each test starts empty. */
const resetHistory = async (page: import('@playwright/test').Page) => {
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.setState("queryHistory", [])
        ;(window as any).useHistoryStore.getState().hydrate()
    })
}

const seedQueryTable = async (page: import('@playwright/test').Page) => {
    await gotoApp(page)
    await resetHistory(page)
    await seed(page, 'history_test', '`id` INT PRIMARY KEY, `name` TEXT', ['id', 'name'], [[1, 'first'], [2, 'second'], [3, 'third']])
    await expect(page.getByTestId('row-count')).toHaveText('3 rows')
}

/** Waits until the workspace state on the server holds `count` entries. */
const waitForPersisted = async (page: import('@playwright/test').Page, count: number) => {
    await expect.poll(async () => page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.downloadState()
        const list = remote.getState("queryHistory")
        return Array.isArray(list) ? list.length : 0
    }), { timeout: 5000 }).toBe(count)
}

/** Runs one statement through the viewer's query box. */
const run = async (page: import('@playwright/test').Page, sql: string) => {
    await page.getByTestId('mode-query').click()
    await page.getByTestId('custom-query-input').fill(sql)
    await page.getByTestId('run-query').click()
}

const openHistory = (page: import('@playwright/test').Page) => page.getByTestId('history-button').click()

test('history records only successful executions and lists the newest first', async ({ page }) => {
    await seedQueryTable(page)
    await run(page, 'SELECT * FROM history_test')
    await run(page, 'SELECT id FROM history_test WHERE id > 1')

    // A failing statement leaves no entry.
    await page.getByTestId('custom-query-input').fill('SELECT * FROM missing_table')
    await page.getByTestId('run-query').click()
    await expect(page.getByTestId('query-error')).toContainText("doesn't exist")

    await openHistory(page)
    await expect(page.getByTestId('history-count')).toHaveText('2')
    const items = page.getByTestId('history-item')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('SELECT id FROM history_test')
    await expect(items.nth(1)).toContainText('SELECT * FROM history_test')
    // Each entry carries the database, the row count and a timestamp.
    await expect(items.nth(0)).toContainText('viewer_test')
    await expect(items.nth(0)).toContainText('2 rows')
})

test('a statement executed twice in a row keeps one entry', async ({ page }) => {
    await seedQueryTable(page)
    await run(page, 'SELECT count(*) FROM history_test;')
    await page.getByTestId('run-query').click()
    await openHistory(page)
    // The trailing semicolon and the repeat both collapse into one entry.
    await expect(page.getByTestId('history-count')).toHaveText('1')
    await expect(page.getByTestId('history-item')).toHaveCount(1)
    await expect(page.getByTestId('history-item')).toContainText('SELECT count(*) FROM history_test')
})

test('history filters, replays, deletes and clears', async ({ page }) => {
    await seedQueryTable(page)
    await run(page, 'SELECT * FROM history_test')
    await run(page, 'SELECT id FROM history_test')

    await openHistory(page)
    await page.getByTestId('history-filter').fill('SELECT id')
    await expect(page.getByTestId('history-item')).toHaveCount(1)
    await page.getByTestId('history-filter').fill('nothing matches this')
    await expect(page.getByTestId('history-no-match')).toBeVisible()
    await page.getByTestId('history-filter').fill('')
    await expect(page.getByTestId('history-item')).toHaveCount(2)

    // Replaying switches back to the query mode and runs the statement again.
    await page.getByTestId('history-item').nth(1).getByTestId('history-replay').click()
    await expect(page.getByTestId('mode-query')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('custom-query-input')).toHaveValue('SELECT * FROM history_test')
    await expect(page.getByTestId('row-count')).toHaveText('3 rows')
    // The replay is recorded too: the list is A, B, A.
    await openHistory(page)
    await expect(page.getByTestId('history-count')).toHaveText('3')
    await expect(page.getByTestId('history-item').first()).toContainText('SELECT * FROM history_test')

    // Deleting one entry keeps the others.
    await page.getByTestId('history-delete').first().click()
    await expect(page.getByTestId('history-item')).toHaveCount(2)
    await expect(page.getByTestId('history-item').first()).toContainText('SELECT id FROM history_test')

    // Clearing asks first; cancelling keeps everything.
    await page.getByTestId('history-clear').click()
    await page.getByTestId('history-clear-cancel').click()
    await expect(page.getByTestId('history-item')).toHaveCount(2)
    await page.getByTestId('history-clear').click()
    await page.getByTestId('history-clear-confirm').click()
    await expect(page.getByTestId('history-empty')).toBeVisible()
    await expect(page.getByTestId('history-count')).toHaveText('0')
})

test('history survives a reload and stays empty after clearing', async ({ page }) => {
    await seedQueryTable(page)
    await run(page, 'SELECT * FROM history_test')
    await openHistory(page)
    await expect(page.getByTestId('history-count')).toHaveText('1')

    // The entry is persisted to the workspace state, so a fresh page still sees it.
    await waitForPersisted(page, 1)
    await page.reload()
    await openHistory(page)
    await expect(page.getByTestId('history-count')).toHaveText('1')
    await expect(page.getByTestId('history-item')).toContainText('SELECT * FROM history_test')

    await page.getByTestId('history-clear').click()
    await page.getByTestId('history-clear-confirm').click()
    await expect(page.getByTestId('history-empty')).toBeVisible()
    await waitForPersisted(page, 0)
    await page.reload()
    await openHistory(page)
    await expect(page.getByTestId('history-empty')).toBeVisible()
})

test('the history rules are pure functions: dedupe, limits and truncation', async ({ page }) => {
    await gotoApp(page)
    const result = await page.evaluate(async () => {
        const h = await (new Function('return import("/query-history.ts")'))()
        type Entry = { sql: string, database: string, executedAt: number, durationMs: number, rows: number, truncated: boolean }
        const entry = (sql: string, at = 1): Entry => ({ sql, database: 'db', executedAt: at, durationMs: 1, rows: 1, truncated: false })
        const fill = (count: number, make: (i: number) => Entry) => {
            let entries: Entry[] = []
            for (let i = 0; i < count; i++) { entries = h.push(entries, make(i)) }
            return entries
        }
        const dedupe: Entry[] = h.push([entry('SELECT 1', 1)], entry('  SELECT 1 ;  ', 2))
        const alternating: Entry[] = h.push(h.push([], entry('A')), entry('B'))
        const alternating2: Entry[] = h.push(alternating, entry('A', 3))
        const many: Entry[] = fill(130, (i) => entry(`SELECT ${i}`, i))
        const long: Entry[] = h.push([], entry('x'.repeat(9_000)))
        const huge: Entry[] = fill(60, (i) => entry('y'.repeat(7_000), i))
        return {
            dedupeLength: dedupe.length,
            dedupeTime: dedupe[0]!.executedAt,
            alternating: alternating2.map((e: Entry) => e.sql),
            manyLength: many.length,
            manyNewest: many[0]!.sql,
            longLength: long[0]!.sql.length,
            longTruncated: long[0]!.truncated,
            hugeBytes: huge.reduce((sum: number, e: Entry) => sum + h.entrySize(e), 0),
            summary: h.summarize(`SELECT\n  ${'a'.repeat(200)}`),
        }
    })
    expect(result.dedupeLength).toBe(1)
    expect(result.dedupeTime).toBe(2)
    expect(result.alternating).toEqual(['A', 'B', 'A'])
    expect(result.manyLength).toBe(100)
    expect(result.manyNewest).toBe('SELECT 129')
    expect(result.longLength).toBe(8_000)
    expect(result.longTruncated).toBe(true)
    expect(result.hugeBytes).toBeLessThanOrEqual(256 * 1024)
    expect(result.summary.endsWith('…')).toBe(true)
    expect(result.summary).not.toContain('\n')
})
