import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "./components"
import { useHistoryStore, summarize } from "./query-history"
import type { HistoryEntry } from "./query-history"

const time = (executedAt: number) => new Date(executedAt).toLocaleString()
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
const UNDO_MS = 3_000

/** Lists executed queries and replays the selected one. History is stored, results are not. */
export const HistoryView = (props: { onReplay: (entry: HistoryEntry) => void }) => {
    const entries = useHistoryStore((s) => s.entries)
    const remove = useHistoryStore((s) => s.remove)
    const restore = useHistoryStore((s) => s.restore)
    const clear = useHistoryStore((s) => s.clear)
    const saveFailed = useHistoryStore((s) => s.saveFailed)
    const [filter, setFilter] = useState("")
    const [confirming, setConfirming] = useState(false)
    const [active, setActive] = useState(0)
    const [undone, setUndone] = useState<{ entry: HistoryEntry, index: number } | null>(null)
    const confirmRef = useRef<HTMLDialogElement>(null)
    const filterRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLOListElement>(null)

    const needle = filter.trim().toLowerCase()
    const visible = needle === "" ? entries : entries.filter((entry) => entry.sql.toLowerCase().includes(needle))
    const activeRow = visible[Math.min(active, Math.max(0, visible.length - 1))]

    useEffect(() => {
        if (confirming) { confirmRef.current?.showModal() } else { confirmRef.current?.close() }
    }, [confirming])
    useEffect(() => { setActive(0) }, [needle])
    useEffect(() => {
        if (undone === null) { return }
        const timer = setTimeout(() => setUndone(null), UNDO_MS)
        return () => clearTimeout(timer)
    }, [undone])
    // Keep the selected row visible while walking the list with the arrow keys.
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
    }, [active, needle])

    const deleteAt = (index: number) => {
        const entry = visible[index]
        if (entry === undefined) { return }
        setUndone({ entry, index })
        remove(entry.executedAt)
        setActive(Math.max(0, Math.min(index, visible.length - 2)))
    }

    const onKeyDown = (ev: KeyboardEvent) => {
        if (visible.length === 0) { return }
        const index = Math.min(active, visible.length - 1)
        if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((index + 1) % visible.length) }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((index - 1 + visible.length) % visible.length) }
        else if (ev.key === "Enter") { ev.preventDefault(); const entry = visible[index]; if (entry !== undefined) { props.onReplay(entry) } }
        else if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); deleteAt(index) }
    }

    return <section class="history-view" data-testid="history-view" onKeyDown={onKeyDown}>
        <div class="history-heading">
            <div>
                <h2>Query history</h2>
                <p>
                    <span data-testid="history-count">{entries.length}</span> saved {entries.length === 1 ? "query" : "queries"}
                    {needle !== "" && <span data-testid="history-match"> · {visible.length} / {entries.length} matching</span>}
                </p>
            </div>
            <div class="history-actions">
                <input
                    ref={filterRef}
                    class="history-filter"
                    aria-label="Filter history"
                    placeholder="Filter history…"
                    data-testid="history-filter"
                    value={filter}
                    onInput={(ev) => setFilter(ev.currentTarget.value)} />
                <Button secondary disabled={entries.length === 0} onClick={() => setConfirming(true)} data-testid="history-clear">Clear all</Button>
            </div>
        </div>
        <p class="history-note" data-testid="history-note">Replaying runs the statement again, so you see the current data. The statements are stored in plain text in this workspace's state.</p>
        {saveFailed && <p class="viewer-error" role="alert" data-testid="history-save-error">The history could not be saved to the workspace state.</p>}

        {undone !== null && <div class="history-undo" data-testid="history-undo">
            Deleted one saved query
            <button type="button" class="history-undo-action" onClick={() => { restore(undone.entry, undone.index); setUndone(null) }} data-testid="history-undo-button">Undo</button>
        </div>}

        {entries.length === 0
            ? <div class="viewer-empty" data-testid="history-empty">
                <strong>No queries yet</strong>
                <p>Run a statement in Custom query mode; the ones that succeed appear here.</p>
            </div>
            : visible.length === 0
                ? <div class="viewer-empty" data-testid="history-no-match">
                    <strong>No matching query</strong>
                    <p>Clear the filter to see every saved statement.</p>
                    <Button class="mt-2" secondary onClick={() => { setFilter(""); filterRef.current?.focus() }} data-testid="history-clear-filter">Clear filter</Button>
                </div>
                : <ol class="history-list" ref={listRef} tabIndex={0} aria-label="Saved queries" data-testid="history-list">
                    {visible.map((entry, index) => <li class="history-item" data-testid="history-item" data-active={entry === activeRow} key={entry.executedAt}>
                        <button type="button" class="history-replay" onClick={() => props.onReplay(entry)} data-testid="history-replay" title="Run this statement again">
                            <code class="history-sql">{summarize(entry.sql)}</code>
                            <span class="history-meta">
                                <span>{entry.database}</span>
                                <span class="history-sep">·</span>
                                <span>{time(entry.executedAt)}</span>
                                <span class="history-sep">·</span>
                                <span>{duration(entry.durationMs)}</span>
                                <span class="history-sep">·</span>
                                <span>{entry.rows} {entry.rows === 1 ? "row" : "rows"}</span>
                                {entry.truncated && <span class="history-badge">truncated</span>}
                            </span>
                        </button>
                        <span class="history-side">
                            <button type="button" class="history-icon" aria-label="Run again" title="Run again" onClick={() => props.onReplay(entry)}>↻</button>
                            <button type="button" class="history-icon history-delete" aria-label="Delete this entry" title="Delete this entry" onClick={() => deleteAt(index)} data-testid="history-delete">×</button>
                        </span>
                    </li>)}
                </ol>}

        <div class="history-foot">
            <span>↑ ↓ select · Enter replay · Delete remove · Esc back to Table</span>
            <span class="history-foot-spacer"></span>
            <span>Newest 100 kept · each statement at most 8,000 characters</span>
        </div>

        <dialog ref={confirmRef} class="py-4 px-8 bg-gray-100 shadow-lg mx-auto mt-[10vh]">
            <h2 class="pb-2 pl-0 text-center [font-size:120%]">Clear the whole query history?</h2>
            <p class="pb-3 text-center">Saved statements are removed from this workspace. Queries that are already open are not affected.</p>
            <div class="float-right">
                <Button class="mr-1" onClick={() => { setConfirming(false); clear() }} data-testid="history-clear-confirm">Clear history</Button>
                <Button secondary onClick={() => setConfirming(false)} data-testid="history-clear-cancel">Cancel</Button>
            </div>
        </dialog>
    </section>
}
