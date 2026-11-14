/** The tab model behind the results panel: at most `RESULT_TAB_LIMIT` results, oldest evicted first. */

export type ResultTabData = {
    /** Statement that produced this result, used by Re-run. */
    sql: string
    /** One-line label without comments; shown in the tab and the header. */
    summary?: string
    columns: string[]
    /** Display-ready cell strings; the extension already capped the row count. */
    rows: string[][]
    /** Rows in the full result, which can be more than `rows.length`. */
    total: number
    durationMs: number
    /** True between the click and the server's answer, so the panel can show that work is happening. */
    running?: boolean
}

export type ResultTab = ResultTabData & { id: string }

export const RESULT_TAB_LIMIT = 5

/** Appends a result and drops the oldest ones beyond the limit. */
export const addTab = (tabs: readonly ResultTab[], tab: ResultTab): ResultTab[] =>
    [...tabs, tab].slice(-RESULT_TAB_LIMIT)

export const closeTab = (tabs: readonly ResultTab[], id: string): ResultTab[] =>
    tabs.filter((tab) => tab.id !== id)

/** Replaces the data of one tab, which is what Re-run does: same tab, fresh rows. */
export const replaceTab = (tabs: readonly ResultTab[], id: string, data: ResultTabData): ResultTab[] =>
    tabs.map((tab) => tab.id === id ? { ...tab, ...data, running: false } : tab)

/** One line, bounded, for the tab title. */
export const tabLabel = (sql: string, max = 48): string => {
    const oneLine = sql.replace(/\s+/g, " ").trim()
    return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/**
 * A label for the tab: the statement with its comments removed, so a SELECT whose columns were
 * commented out does not turn the title into `SELECT -- sequence, -- kind…`.
 */
export const statementSummary = (sql: string, max = 72): string => {
    let text = ""
    let index = 0
    while (index < sql.length) {
        const character = sql[index]!
        const next = sql[index + 1]
        if (character === "-" && next === "-" || character === "#") {
            const end = sql.indexOf("\n", index)
            index = end === -1 ? sql.length : end
            text += " "
            continue
        }
        if (character === "/" && next === "*") {
            const end = sql.indexOf("*/", index + 2)
            index = end === -1 ? sql.length : end + 2
            text += " "
            continue
        }
        if (character === "'" || character === '"' || character === "`") {
            const quote = character
            const from = index
            index += 1
            while (index < sql.length) {
                const current = sql[index]!
                if (current === "\\" && quote !== "`") { index += 2; continue }
                if (current === quote) {
                    if (sql[index + 1] === quote) { index += 2; continue }
                    index += 1
                    break
                }
                index += 1
            }
            text += sql.slice(from, index)
            continue
        }
        text += character
        index += 1
    }
    return tabLabel(text, max)
}
