import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks"
import type { JSXInternal } from "preact/src/jsx"

/** SQLite keywords, mirrored from `vscode/sqlite-keywords.ts` because the webview cannot import outside `ui/`. */
const KEYWORDS = [
    "ABORT", "ACTION", "ADD", "AFTER", "ALL", "ALTER", "ALWAYS", "ANALYZE",
    "AND", "AS", "ASC", "ATTACH", "AUTOINCREMENT", "BEFORE", "BEGIN", "BETWEEN",
    "BLOB", "BY", "CASCADE", "CASE", "CAST", "CHECK", "COLLATE", "COLUMN",
    "COMMIT", "CONFLICT", "CONSTRAINT", "CREATE", "CROSS", "CURRENT", "CURRENT_DATE", "CURRENT_TIME",
    "CURRENT_TIMESTAMP", "DATABASE", "DEFAULT", "DEFERRABLE", "DEFERRED", "DELETE", "DESC", "DETACH",
    "DISTINCT", "DO", "DROP", "EACH", "ELSE", "END", "ESCAPE", "EXCEPT",
    "EXCLUDE", "EXCLUSIVE", "EXISTS", "EXPLAIN", "FAIL", "FALSE", "FILTER", "FIRST",
    "FOLLOWING", "FOR", "FOREIGN", "FROM", "FULL", "GENERATED", "GLOB", "GROUP",
    "GROUPS", "HAVING", "IF", "IGNORE", "IMMEDIATE", "IN", "INDEX", "INDEXED",
    "INITIALLY", "INNER", "INSERT", "INSTEAD", "INTEGER", "INTERSECT", "INTO", "IS",
    "ISNULL", "JOIN", "KEY", "LAST", "LEFT", "LIKE", "LIMIT", "MATCH",
    "MATERIALIZED", "NATURAL", "NEW", "NO", "NOT", "NOTHING", "NOTNULL", "NULL",
    "NULLS", "OF", "OFFSET", "OLD", "ON", "OR", "ORDER", "OTHERS",
    "OUTER", "OVER", "PARTITION", "PLAN", "PRAGMA", "PRECEDING", "PRIMARY", "QUERY",
    "RAISE", "RANGE", "REAL", "RECURSIVE", "REFERENCES", "REGEXP", "REINDEX", "RELEASE",
    "RENAME", "REPLACE", "RESTRICT", "RETURNING", "RIGHT", "ROLLBACK", "ROW", "ROWID",
    "ROWS", "SAVEPOINT", "SELECT", "SET", "STORED", "STRICT", "TABLE", "TEMP",
    "TEMPORARY", "TEXT", "THEN", "TIES", "TO", "TRANSACTION", "TRIGGER", "TRUE",
    "UNBOUNDED", "UNION", "UNIQUE", "UPDATE", "USING", "VACUUM", "VALUES", "VIEW",
    "VIRTUAL", "WHEN", "WHERE", "WINDOW", "WITH", "WITHIN", "WITHOUT",
]

type Candidate = { label: string, kind: "column" | "table" | "keyword" }

/** Reads the identifier immediately before the caret. */
const prefixAt = (text: string, caret: number) => /[A-Za-z_][A-Za-z0-9_$]*$/.exec(text.slice(0, caret))?.[0] ?? ""

/** Tables named after FROM, JOIN, UPDATE or INTO in the statement. */
export const referencedTables = (sql: string) => {
    const names = new Set<string>()
    for (const match of sql.matchAll(/\b(?:from|join|update|into)\s+(?:"([^"]+)"|\[([^\]]+)\]|`([^`]+)`|([A-Za-z_][\w$]*))/gi)) {
        const name = match[1] ?? match[2] ?? match[3] ?? match[4]
        if (name !== undefined) { names.add(name) }
    }
    return [...names]
}

/** Caret position in viewport coordinates, measured with a hidden copy of the textarea. */
const caretPosition = (textarea: HTMLTextAreaElement) => {
    const style = getComputedStyle(textarea)
    const mirror = document.createElement("div")
    for (const property of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "whiteSpace", "wordBreak", "tabSize"] as const) {
        mirror.style[property] = style[property]
    }
    Object.assign(mirror.style, {
        position: "absolute", visibility: "hidden", top: "0", left: "0", boxSizing: "border-box",
        width: textarea.clientWidth + "px", height: "auto", overflow: "hidden",
    })
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart)
    const marker = document.createElement("span")
    marker.textContent = "\u00a0"
    mirror.append(marker)
    document.body.append(mirror)
    const rect = textarea.getBoundingClientRect()
    const left = rect.left + marker.offsetLeft - textarea.scrollLeft
    const top = rect.top + marker.offsetTop - textarea.scrollTop + Number.parseFloat(style.lineHeight || style.fontSize || "16")
    mirror.remove()
    return { left, top }
}

/**
 * Completion popup for the read-only query composer.
 * Listeners live on the document so that they are in place before the first keystroke after mounting.
 */
export const SqlCompletion = (props: {
    textarea: HTMLTextAreaElement | null
    tables: readonly string[]
    columns: readonly string[]
    fetchColumns: (table: string) => Promise<string[]>
}) => {
    const [items, setItems] = useState<Candidate[]>([])
    const [active, setActive] = useState(0)
    const [position, setPosition] = useState({ left: 0, top: 0 })
    const [open, setOpen] = useState(false)
    const fetched = useRef(new Map<string, string[]>())
    /** Drops results of superseded refreshes so that fast typing cannot reopen or close the wrong list. */
    const generation = useRef(0)
    /** Values that the document-level handlers must see, whatever render they were attached in. */
    const latest = useRef({ open, items, active, textarea: props.textarea })
    latest.current = { open, items, active, textarea: props.textarea }

    const candidateList = useMemo(() => (prefix: string) => {
        const lower = prefix.toLowerCase()
        const matches: Candidate[] = []
        for (const column of new Set(props.columns)) { if (column.toLowerCase().startsWith(lower) && column !== prefix) { matches.push({ label: column, kind: "column" }) } }
        for (const table of props.tables) { if (table.toLowerCase().startsWith(lower) && table !== prefix) { matches.push({ label: table, kind: "table" }) } }
        for (const keyword of KEYWORDS) { if (keyword.toLowerCase().startsWith(lower) && keyword.toLowerCase() !== lower) { matches.push({ label: keyword, kind: "keyword" }) } }
        const unique = [...new Map(matches.map((item) => [item.label.toLowerCase(), item])).values()]
        return unique.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "keyword" ? 1 : b.kind === "keyword" ? -1 : 0)).slice(0, 8)
    }, [props.tables, props.columns])

    const refresh = useMemo(() => async (auto: boolean) => {
        const mine = ++generation.current
        const textarea = latest.current.textarea
        if (!textarea) { return }
        const caret = textarea.selectionStart
        const prefix = prefixAt(textarea.value, caret)
        if (auto && prefix.length < 2) { if (mine === generation.current) { setOpen(false) } return }

        // Merge the current table's columns with the columns of the tables named in the statement.
        const extra: string[] = []
        for (const table of referencedTables(textarea.value)) {
            const cached = fetched.current.get(table)
            if (cached) { extra.push(...cached); continue }
            try {
                const result = await props.fetchColumns(table)
                if (mine !== generation.current) { return }
                fetched.current.set(table, result)
                extra.push(...result)
            } catch { /* unknown table: no suggestions from it */ }
        }
        if (mine !== generation.current) { return }
        const ordered = candidateList(prefix)
        if (extra.length > 0) {
            const lower = prefix.toLowerCase()
            const fromExtra = extra.filter((column) => column.toLowerCase().startsWith(lower) && column !== prefix && !ordered.some((item) => item.label === column)).map((column): Candidate => ({ label: column, kind: "column" }))
            ordered.unshift(...fromExtra)
            ordered.splice(8)
        }
        setItems(ordered)
        setActive(0)
        setOpen(ordered.length > 0)
        if (ordered.length > 0) {
            const caret = caretPosition(textarea)
            // Keep the list inside the window when the caret is near the bottom edge.
            const room = 26 * ordered.length + 12
            setPosition({ left: caret.left, top: Math.max(8, Math.min(caret.top, window.innerHeight - room)) })
        }
    }, [candidateList, props.fetchColumns])

    const insert = (candidate: Candidate) => {
        const textarea = latest.current.textarea
        if (!textarea) { return }
        const caret = textarea.selectionStart
        const prefix = prefixAt(textarea.value, caret)
        textarea.setRangeText(candidate.label, caret - prefix.length, caret, "end")
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        textarea.focus()
        setOpen(false)
    }

    useLayoutEffect(() => {
        const isComposer = (target: EventTarget | null) => target !== null && target === latest.current.textarea
        const onInput = (event: Event) => {
            if (!isComposer(event.target)) { return }
            const data = (event as InputEvent).data ?? ""
            if (data === "" || /[\w$]$/.test(data)) { refresh(true).catch(console.error) } else { setOpen(false) }
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isComposer(event.target)) { return }
            if (event.ctrlKey && event.code === "Space") {
                event.preventDefault()
                refresh(false).catch(console.error)
                return
            }
            const current = latest.current
            if (!current.open) { return }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                const step = event.key === "ArrowDown" ? 1 : -1
                setActive((active) => (active + step + current.items.length) % current.items.length)
            } else if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault()
                event.stopPropagation()
                const item = current.items[current.active]
                if (item) { insert(item) }
            } else if (event.key === "Escape") {
                // Keep the caret in the editor: the global Escape handler would blur it.
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
            } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                setOpen(false)
            }
        }
        const onFocusOut = (event: FocusEvent) => {
            if (isComposer(event.target)) { setOpen(false) }
        }
        document.addEventListener("input", onInput, true)
        document.addEventListener("keydown", onKeyDown, true)
        document.addEventListener("focusout", onFocusOut, true)
        return () => {
            document.removeEventListener("input", onInput, true)
            document.removeEventListener("keydown", onKeyDown, true)
            document.removeEventListener("focusout", onFocusOut, true)
        }
    }, [refresh])

    if (!open) { return null }
    const prefix = prefixAt(latest.current.textarea?.value ?? "", latest.current.textarea?.selectionStart ?? 0)
    return <ul
        class="sql-completion"
        role="listbox"
        aria-label="SQL suggestions"
        data-testid="sql-completion"
        style={{ left: position.left + "px", top: position.top + "px" }}
        onMouseDown={(event: JSXInternal.TargetedMouseEvent<HTMLUListElement>) => { event.preventDefault() }}>
        {items.map((item, index) => <li
            key={item.kind + " " + item.label}
            role="option"
            aria-selected={index === active}
            class={"sql-completion-item" + (index === active ? " active" : "")}
            onMouseMove={() => { setActive(index) }}
            onClick={() => { insert(item) }}>
            <span class={"sql-completion-kind " + item.kind}>{item.kind === "keyword" ? "kw" : item.kind === "table" ? "table" : "col"}</span>
            <span class="sql-completion-label">{item.label}</span>
        </li>)}
    </ul>
}
