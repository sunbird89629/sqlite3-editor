import * as remote from "./remote"
import { createStore } from "./util"

/** One executed read-only query. Only the statement is stored, never the rows. */
export type HistoryEntry = {
    /** The statement as executed, cut at `SQL_LIMIT` characters. */
    sql: string
    /** Database the session was connected to when the statement ran. */
    database: string
    executedAt: number
    durationMs: number
    /** Rows in the result set, as counted by the viewer. */
    rows: number
    /** True when `sql` was cut because the statement was longer than `SQL_LIMIT`. */
    truncated: boolean
}

export const HISTORY_LIMIT = 100
export const SQL_LIMIT = 8_000
export const TOTAL_LIMIT = 256 * 1024

/** Removes the trailing whitespace and semicolons that make two statements look different. */
export const normalizeSQL = (sql: string) => sql.trim().replace(/[;\s]+$/, "")

/** One line, bounded, for the list. */
export const summarize = (sql: string, max = 120) => {
    const oneLine = sql.replace(/\s+/g, " ").trim()
    return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/** Rough byte cost of one entry, used for the total budget. */
export const entrySize = (entry: HistoryEntry) => entry.sql.length + entry.database.length + 64

/** Keeps the newest entries within the count limit and the byte budget. */
export const prune = (entries: readonly HistoryEntry[]): HistoryEntry[] => {
    const kept = entries.slice(0, HISTORY_LIMIT)
    let total = kept.reduce((sum, entry) => sum + entrySize(entry), 0)
    while (kept.length > 1 && total > TOTAL_LIMIT) {
        total -= entrySize(kept.pop()!)
    }
    return kept
}

/**
 * Adds an entry. A statement identical to the newest one replaces it, so a double run does not
 * create a duplicate while "A, B, A" still records A twice.
 */
export const push = (entries: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => {
    const next = entry.sql.length > SQL_LIMIT ? { ...entry, sql: entry.sql.slice(0, SQL_LIMIT), truncated: true } : entry
    const newest = entries[0]
    if (newest !== undefined && normalizeSQL(newest.sql) === normalizeSQL(next.sql)) {
        return prune([next, ...entries.slice(1)])
    }
    return prune([next, ...entries])
}

const isEntry = (value: unknown): value is HistoryEntry => {
    if (typeof value !== "object" || value === null) { return false }
    const { sql, database, executedAt, durationMs, rows, truncated } = value as Record<string, unknown>
    return typeof sql === "string" && typeof database === "string" && typeof executedAt === "number"
        && typeof durationMs === "number" && typeof rows === "number" && typeof truncated === "boolean"
}

/** Reads whatever was persisted, dropping entries that no longer fit the shape. */
export const parseHistory = (value: unknown): HistoryEntry[] => Array.isArray(value) ? prune(value.filter(isEntry)) : []

export const useHistoryStore = createStore("useHistoryStore", {
    entries: [] as HistoryEntry[],
    /** True when the last write to the workspace state failed. */
    saveFailed: false,
}, (set, get) => {
    // Writes are chained so that a later snapshot cannot be overwritten by an earlier one. Each
    // change is written immediately: a query is a user action, and a delayed write can be lost
    // when the window closes right after it.
    let pending: Promise<unknown> = Promise.resolve()
    const persist = () => {
        const entries = get().entries
        pending = pending.then(
            () => remote.setState("queryHistory", entries).then(
                () => { if (get().saveFailed) { set({ saveFailed: false }) } },
                () => { set({ saveFailed: true }) },
            ),
            () => undefined,
        )
    }
    return {
        /** Called once after `downloadState()`; a missing or malformed value yields an empty history. */
        hydrate: () => { set({ entries: parseHistory(remote.getState("queryHistory")) }) },
        record: (entry: HistoryEntry) => { set({ entries: push(get().entries, entry) }); persist() },
        /** Entries are identified by their execution time. */
        remove: (executedAt: number) => { set({ entries: get().entries.filter((entry) => entry.executedAt !== executedAt) }); persist() },
        /** Puts a deleted entry back where it was, for the undo action. */
        restore: (entry: HistoryEntry, index: number) => {
            const entries = [...get().entries]
            if (entries.some((existing) => existing.executedAt === entry.executedAt)) { return }
            entries.splice(Math.max(0, Math.min(index, entries.length)), 0, entry)
            set({ entries: prune(entries) })
            persist()
        },
        clear: () => { set({ entries: [] }); persist() },
    }
})
