import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { fuzzyFilter } from "./fuzzy"
import type { ColumnInfo } from "./dialect"

/** The `SELECT` column list: a trigger showing the current columns and a searchable, bulk-toggle popover. */
export const ColumnPicker = (props: {
    columns: readonly ColumnInfo[]
    visible: readonly string[]
    /** Receives the whole new selection so a bulk action only reloads the viewer once. */
    onChange: (names: string[]) => Promise<void> | void
    /** Rendered before the trigger, e.g. the `SELECT` keyword. */
    children?: preact.ComponentChildren
}) => {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [cursor, setCursor] = useState(0)
    const [message, setMessage] = useState("")
    const popoverRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)

    const visible = useMemo(() => new Set(props.visible), [props.visible])
    const rows = useMemo(() => fuzzyFilter(props.columns, query), [props.columns, query])

    const close = () => {
        setOpen(false)
        triggerRef.current?.focus()
    }
    const apply = (names: string[], nextMessage = "") => {
        setMessage(nextMessage)
        void props.onChange(names)
    }
    const toggle = (name: string) => {
        if (visible.has(name)) {
            if (visible.size === 1) { setMessage("Keep at least one column visible."); return }
            apply(props.visible.filter((column) => column !== name))
            return
        }
        apply([...props.visible, name])
    }

    useEffect(() => { setCursor(0); setMessage("") }, [query, open])

    useEffect(() => {
        if (!open) { return }
        searchRef.current?.focus()
        const onPointerDown = (ev: PointerEvent) => {
            const target = ev.target as Node
            if (popoverRef.current?.contains(target)) { return }
            setOpen(false)
        }
        // Esc clears the filter first and closes on the next press, wherever the focus is.
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape") { return }
            ev.preventDefault()
            ev.stopPropagation()
            const input = searchRef.current
            if (input !== null && input.value !== "") { setQuery(""); input.focus() } else { setOpen(false); triggerRef.current?.focus() }
        }
        document.addEventListener("pointerdown", onPointerDown)
        document.addEventListener("keydown", onKeyDown, true)
        return () => {
            document.removeEventListener("pointerdown", onPointerDown)
            document.removeEventListener("keydown", onKeyDown, true)
        }
    }, [open])

    const onSearchKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "ArrowDown") { ev.preventDefault(); setCursor((index) => Math.min(rows.length - 1, index + 1)) }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); setCursor((index) => Math.max(0, index - 1)) }
        else if (ev.key === " ") {
            ev.preventDefault()
            const row = rows[cursor]
            if (row !== undefined) { toggle(row.name) }
        } else if (ev.key === "Enter") { ev.preventDefault(); close() }
    }

    const matchingVisible = rows.filter((row) => visible.has(row.name)).length
    const triggerLabel = props.visible.length === 1
        ? `\`${props.visible[0]}\``
        : `${props.visible.slice(0, 3).map((name) => `\`${name}\``).join(", ")}, … ${props.visible.length} columns`

    return <>
        {props.children}
        <span class="column-picker">
            <button
                type="button"
                ref={triggerRef}
                aria-label="Select visible columns"
                aria-haspopup="dialog"
                aria-expanded={open}
                data-testid="column-picker-trigger"
                class="column-picker-trigger"
                onClick={() => { setOpen(!open); setQuery(""); setMessage("") }}>{triggerLabel}</button>

            {open && <div ref={popoverRef} class="column-picker-popover" role="dialog" aria-label="Visible columns" data-testid="column-picker">
                <div class="column-picker-head">
                    <div class="column-picker-title">
                        <span>Visible columns</span>
                        <span class="column-picker-count" data-testid="column-picker-count">{visible.size} / {props.columns.length}</span>
                    </div>
                    <div class="column-picker-search">
                        <input
                            ref={searchRef}
                            aria-label="Filter columns"
                            placeholder="Filter columns…  fuzzy"
                            data-testid="column-picker-search"
                            value={query}
                            autocomplete="off"
                            spellcheck={false}
                            onInput={(ev) => setQuery(ev.currentTarget.value)}
                            onKeyDown={onSearchKeyDown} />
                        {query !== "" && <button type="button" class="column-picker-search-clear" aria-label="Clear filter" data-testid="column-picker-search-clear" onClick={() => { setQuery(""); searchRef.current?.focus() }}>×</button>}
                    </div>
                </div>

                <div class="column-picker-bulk">
                    <button
                        type="button"
                        class="column-picker-link"
                        disabled={rows.length === 0 || matchingVisible === rows.length}
                        onClick={() => apply([...new Set([...props.visible, ...rows.map((row) => row.name)])])}
                        data-testid="column-picker-select-all">{query === "" ? "Select all" : `Select ${rows.length} match${rows.length === 1 ? "" : "es"}`}</button>
                    <span class="column-picker-sep">·</span>
                    <button
                        type="button"
                        class="column-picker-link"
                        disabled={matchingVisible === 0 || matchingVisible === visible.size && matchingVisible <= 1}
                        onClick={() => {
                            // Clear the matches; only when nothing outside the filter stays visible do we keep one.
                            const matched = rows.filter((row) => visible.has(row.name)).map((row) => row.name)
                            const outside = props.visible.filter((name) => !matched.includes(name))
                            const next = outside.length > 0 ? outside : matched.slice(0, 1)
                            apply(next, outside.length === 0 && matched.length > 1 ? "Keep at least one column visible." : "")
                        }}
                        data-testid="column-picker-clear-all">{query === "" ? "Clear all" : `Clear ${rows.length} match${rows.length === 1 ? "" : "es"}`}</button>
                    {query !== "" && <span class="column-picker-hint">{rows.length} match{rows.length === 1 ? "" : "es"}</span>}
                </div>

                <div class="column-picker-list" role="listbox" aria-label="Columns" data-testid="column-picker-list">
                    {rows.length === 0
                        ? <div class="column-picker-empty" data-testid="column-picker-no-match">
                            <strong>No column matches “{query}”</strong>
                            Press Esc to clear the filter.
                        </div>
                        : rows.map((row, index) => <label
                            class="column-picker-item"
                            data-testid={`column-picker-item ${row.name}`}
                            data-cursor={index === cursor}
                            data-active={visible.has(row.name)}
                            aria-selected={visible.has(row.name)}
                            onMouseEnter={() => setCursor(index)}>
                            <input
                                type="checkbox"
                                tabIndex={-1}
                                checked={visible.has(row.name)}
                                onChange={() => toggle(row.name)} />
                            <span class="column-picker-name">{highlight(row.name, row.hits)}</span>
                            {row.primaryKey && <span class="column-picker-pk">PK</span>}
                            <span class="column-picker-type">{row.type}</span>
                        </label>)}
                </div>

                {message !== "" && <p class="column-picker-error" role="status">{message}</p>}
                <div class="column-picker-foot">
                    <kbd>↑</kbd><kbd>↓</kbd> move <kbd>Space</kbd> toggle <kbd>Enter</kbd> done <kbd>Esc</kbd> close
                </div>
            </div>}
        </span>
    </>
}

/** Renders a column name with the fuzzy-matched characters wrapped in `<mark>`. */
const highlight = (name: string, hits: readonly number[]) => {
    if (hits.length === 0) { return name }
    const set = new Set(hits)
    return <>{[...name].map((character, index) => set.has(index) ? <mark>{character}</mark> : character)}</>
}
