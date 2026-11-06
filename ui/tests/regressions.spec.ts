import { test, expect } from '@playwright/test'

test('row selectors and inserts preserve the intended records and types', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    const result = await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        const editor = (window as any).useEditorStore
        table.setState({ autoReload: false })
        for (const sql of [
            'DROP TABLE IF EXISTS "regression rowid"',
            'DROP TABLE IF EXISTS "regression composite"',
            'DROP TABLE IF EXISTS "regression insert"',
            'CREATE TABLE "regression rowid" (rowid INTEGER, "select" TEXT)',
            'INSERT INTO "regression rowid" VALUES (7, \'first\')',
            'INSERT INTO "regression rowid" VALUES (7, \'second\')',
            'CREATE TABLE "regression composite" (a INTEGER, b INTEGER, value TEXT, PRIMARY KEY(a,b)) WITHOUT ROWID',
            'INSERT INTO "regression composite" VALUES (1,1,\'first\')',
            'INSERT INTO "regression composite" VALUES (1,2,\'second\')',
            'CREATE TABLE "regression insert" (a TEXT DEFAULT \'default\', b INTEGER)',
        ]) { await remote.query(sql, [], 'w+') }
        await table.getState().reloadAllTables('regression rowid')
        await table.getState().setViewerQuery({ tableName: 'regression rowid' })
        let state = table.getState()
        const hidden = state.rowIdColumn
        const first = state.records[0]
        const selector = state.getRecordSelectors(first)[0]
        editor.getState().update('regression rowid', 'select', 0)
        editor.setState({ textareaValue: 'changed', type: 'string' })
        const update = editor.getState().buildQuery()
        await remote.query(update[0], update[1], 'w+')
        const rowValues = (await remote.query('SELECT "select" FROM "regression rowid" ORDER BY _rowid_', [], 'r')).records.map((x: any) => x.select)

        await table.getState().setViewerQuery({ tableName: 'regression composite' })
        state = table.getState()
        const composite = state.getRecordSelectors(state.records[0])

        await table.getState().setViewerQuery({ tableName: 'regression insert' })
        await editor.getState().insert('regression insert')
        editor.setState({ textareaValues: ['', '42'], blobValues: [null, null], dataTypes: ['default', 'number'] })
        const insert = editor.getState().buildQuery()
        await remote.query(insert[0], insert[1], 'w+')
        const inserted = (await remote.query('SELECT a, b, typeof(b) AS type FROM "regression insert"', [], 'r')).records[0]
        return { hidden, selector, rowValues, composite, inserted: { ...inserted, b: String(inserted.b) } }
    })
    expect(result.hidden).toBe('_rowid_')
    expect(result.selector).toEqual(['_rowid_'])
    expect(result.rowValues).toEqual(['changed', 'second'])
    expect(result.composite).toContainEqual(['a', 'b'])
    expect(result.composite).not.toContainEqual(['a'])
    expect(result.inserted).toEqual({ a: 'default', b: '42', type: 'integer' })
})

test('sequential scrolling uses a rowid cursor', async ({ page }) => {
    const queries: string[] = []
    await page.route('**/query', async (route) => {
        const body = route.request().postDataBuffer()
        if (body) { queries.push(body.toString('utf8')) }
        await route.continue()
    })
    await page.goto('http://localhost:5173/')
    const result = await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        const table = (window as any).useTableStore
        table.setState({ autoReload: false })
        await remote.query('DROP TABLE IF EXISTS "cursor regression"', [], 'w+')
        await remote.query('CREATE TABLE "cursor regression" (a TEXT, b TEXT)', [], 'w+')
        await remote.query("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<80) INSERT INTO \"cursor regression\" SELECT CASE WHEN x%2=0 THEN 'match' ELSE 'other' END, CASE WHEN x%2=1 THEN 'match' ELSE 'other' END FROM n", [], 'w+')
        await table.getState().reloadAllTables('cursor regression')
        await table.getState().setViewerQuery({ tableName: 'cursor regression' })
        await table.getState().setPaging({ visibleAreaTop: 5n })
        return table.getState().records.map((r: any) => String(r.rowid))
    })
    expect(result[0]).toBe('6')
    expect(queries.some((query) => /WHERE "rowid" > \?/.test(query))).toBe(true)
})

test('table find is removed without intercepting Ctrl+F', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await expect(page.getByTestId('find-button')).toHaveCount(0)
    const prevented = await page.evaluate(() => {
        const event = new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
        document.body.dispatchEvent(event)
        return event.defaultPrevented
    })
    expect(prevented).toBe(false)
    await expect(page.locator('#findWidget')).toHaveCount(0)
    await expect(page.getByTestId('query-editor-toggle')).toBeVisible()
    await page.getByTestId('table-name').click()
    await expect(page.getByRole('combobox', { name: 'Search tables or views' })).toBeVisible()
})
