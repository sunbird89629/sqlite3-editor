import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "./components"
import { useHistoryStore, summarize } from "./query-history"
import type { HistoryEntry } from "./query-history"

const time = (executedAt: number) => new Date(executedAt).toLocaleString()
const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`

/** Lists executed queries and replays the selected one. History is stored, results are not. */
export const HistoryView = (props: { onReplay: (entry: HistoryEntry) => void }) => {
    const entries = useHistoryStore((s) => s.entries)
    const remove = useHistoryStore((s) => s.remove)
    const clear = useHistoryStore((s) => s.clear)
    const saveFailed = useHistoryStore((s) => s.saveFailed)
    const [filter, setFilter] = useState("")
    const [confirming, setConfirming] = useState(false)
    const confirmRef = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        if (confirming) { confirmRef.current?.showModal() } else { confirmRef.current?.close() }
    }, [confirming])

    const needle = filter.trim().toLowerCase()
    const visible = needle === "" ? entries : entries.filter((entry) => entry.sql.toLowerCase().includes(needle))

    return <section class="history-view" data-testid="history-view">
        <div class="history-heading">
            <div>
                <h2>Query history</h2>
                <p><span data-testid="history-count">{entries.length}</span> saved {entries.length === 1 ? "query" : "queries"}{needle !== "" && <span> · {visible.length} matching</span>}</p>
            </div>
            <div class="history-actions">
                <input
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

        {entries.length === 0
            ? <div class="viewer-empty" data-testid="history-empty">
                <strong>No queries yet</strong>
                <p>Run a statement in Custom query mode; the ones that succeed appear here.</p>
            </div>
            : visible.length === 0
                ? <div class="viewer-empty" data-testid="history-no-match">
                    <strong>No matching query</strong>
                    <p>Clear the filter to see every saved statement.</p>
                </div>
                : <ol class="history-list">
                    {visible.map((entry) => <li class="history-item" data-testid="history-item" key={entry.executedAt}>
                        <button type="button" class="history-replay" onClick={() => props.onReplay(entry)} data-testid="history-replay" title="Run this statement again">
                            <code class="history-sql">{summarize(entry.sql)}</code>
                            {entry.truncated && <span class="history-badge">truncated</span>}
                            <span class="history-meta">
                                {entry.database} · {time(entry.executedAt)} · {duration(entry.durationMs)} · {entry.rows} {entry.rows === 1 ? "row" : "rows"}
                            </span>
                        </button>
                        <button type="button" class="history-delete" aria-label="Delete this entry" title="Delete this entry" onClick={() => remove(entry.executedAt)} data-testid="history-delete">×</button>
                    </li>)}
                </ol>}

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
