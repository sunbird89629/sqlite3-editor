/** The tab model behind the results panel: at most `RESULT_TAB_LIMIT` results, oldest evicted first. */

export type ResultTabData = {
    /** Statement that produced this result, used by Re-run. */
    sql: string
    columns: string[]
    /** Display-ready cell strings; the extension already capped the row count. */
    rows: string[][]
    /** Rows in the full result, which can be more than `rows.length`. */
    total: number
    durationMs: number
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
    tabs.map((tab) => tab.id === id ? { ...tab, ...data } : tab)

/** One line, bounded, for the tab title. */
export const tabLabel = (sql: string, max = 48): string => {
    const oneLine = sql.replace(/\s+/g, " ").trim()
    return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}
