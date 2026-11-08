import { test, expect } from '@playwright/test'

test('the draft query opens in the SQL editor with the current table and text', async ({ page }) => {
    await page.addInitScript(() => {
        ;(window as any).acquireVsCodeApi = () => ({
            getState: () => undefined, setState: () => {},
            postMessage: async (request: { requestId: number, path: string, body: Uint8Array }) => {
                if (request.path === '/openNativeQuery') {
                    (window as any).openNativeQueryRequests = [...((window as any).openNativeQueryRequests ?? []), request.body]
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, body: new Uint8Array([0xc0]) }, '*')
                    return
                }
                try {
                    const response = await fetch('http://localhost:8080' + request.path, { method: 'POST', body: request.body, headers: { 'Content-Type': 'application/octet-stream' } })
                    const result = response.ok ? { body: new Uint8Array(await response.arrayBuffer()) } : { err: await response.text() }
                    window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, ...result }, '*')
                } catch (error) { window.postMessage({ type: 'sqlite3-editor-server', requestId: request.requestId, err: String(error) }, '*') }
            },
        })
    })
    await page.goto('http://localhost:5173/')
    await page.evaluate(async () => {
        const remote = await (new Function('return import("/remote.ts")'))()
        await remote.query('CREATE TABLE IF NOT EXISTS open_editor_test (id INTEGER PRIMARY KEY)', [], 'w+')
        const table = (window as any).useTableStore
        await table.getState().reloadAllTables('open_editor_test')
        await table.getState().setViewerQuery({ tableName: 'open_editor_test' })
    })
    await page.getByTestId('mode-query').click()
    const draft = 'SELECT id FROM open_editor_test WHERE id > 3'
    await page.getByTestId('custom-query-input').fill(draft)
    await page.getByTestId('open-in-sql-editor').click()
    await expect.poll(async () => (await page.evaluate(() => (window as any).openNativeQueryRequests?.length ?? 0))).toBe(1)
    const body = await page.evaluate(() => Array.from((window as any).openNativeQueryRequests[0] as Uint8Array))
    const text = new TextDecoder().decode(new Uint8Array(body))
    expect(text).toContain('open_editor_test')
    expect(text).toContain(draft)
})
