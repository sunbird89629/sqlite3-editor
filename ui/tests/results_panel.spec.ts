import { test, expect } from '@playwright/test'

/** The results panel is its own webview entry: the extension host sends the tabs by message. */
const sendResult = async (page: import('@playwright/test').Page) => {
    // The webview registers its message listener on mount; wait for the empty state first.
    await expect(page.getByText("No results")).toBeVisible()
    await page.evaluate(() => {
        window.postMessage({
            type: "sqlite3-editor-results",
            activeId: "t1",
            session: "local/evaluation",
            tabs: [{
                id: "t1",
                sql: "SELECT sequence, message_role, message_content FROM turn_events",
                summary: "SELECT sequence, message_role, message_content FROM turn_events",
                columns: ["sequence", "message_role", "message_content"],
                rows: [["11", "assistant", "第一行"], ["12", "user", "第二行"]],
                total: 2,
                durationMs: 12,
            }],
        }, "*")
    })
}

test('the result table shows every column of the tab', async ({ page }) => {
    await page.goto("http://localhost:5173/results.html")
    await sendResult(page)
    await expect(page.locator("th")).toHaveCount(3)
    await expect(page.locator("th").nth(1)).toHaveText("message_role")
    await expect(page.getByTestId("result-columns-button")).toHaveText("Columns 3/3")
})

test('the column filter hides columns without querying again', async ({ page }) => {
    let queries = 0
    page.on("request", (request) => { if (request.url().includes(":8080/query")) { queries += 1 } })
    await page.goto("http://localhost:5173/results.html")
    await sendResult(page)

    await page.getByTestId("result-columns-button").click()
    const picker = page.getByTestId("result-columns")
    await expect(picker).toBeVisible()

    // Hiding a column only changes the table.
    await page.getByTestId("result-column-item message_role").locator("input").uncheck()
    await expect(page.locator("th")).toHaveCount(2)
    await expect(page.locator("th").nth(1)).toHaveText("message_content")
    await expect(page.getByTestId("result-columns-button")).toHaveText("Columns 2/3")
    expect(queries).toBe(0)

    // The last visible column cannot be hidden.
    await page.getByTestId("result-column-item sequence").locator("input").uncheck()
    await page.getByTestId("result-column-item message_content").locator("input").click()
    await expect(page.locator("th")).toHaveCount(1)
    await expect(page.getByTestId("result-columns-button")).toHaveText("Columns 1/3")

    // Select all restores every column, and the picker closes on Escape.
    await picker.getByRole("button", { name: "Select all" }).click()
    await expect(page.locator("th")).toHaveCount(3)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("result-columns")).toHaveCount(0)
    expect(queries).toBe(0)
})

test('the filter searches column names', async ({ page }) => {
    await page.goto("http://localhost:5173/results.html")
    await sendResult(page)
    await page.getByTestId("result-columns-button").click()
    await page.getByRole("textbox", { name: "Filter columns" }).fill("role")
    await expect(page.getByTestId("result-column-item message_role")).toBeVisible()
    await expect(page.getByTestId("result-column-item sequence")).toHaveCount(0)
})

test('the running tab hides the table until rows arrive', async ({ page }) => {
    await page.goto("http://localhost:5173/results.html")
    await expect(page.getByText("No results")).toBeVisible()
    await page.evaluate(() => {
        window.postMessage({
            type: "sqlite3-editor-results",
            activeId: "r1",
            session: "local/evaluation",
            tabs: [{ id: "r1", sql: "SELECT 1", summary: "SELECT 1", columns: [], rows: [], total: 0, durationMs: 0, running: true }],
        }, "*")
    })
    await expect(page.getByTestId("result-running")).toBeVisible()
    await expect(page.locator("th")).toHaveCount(0)
})
