import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"
import type { JSXInternal } from "preact/src/jsx"
import type { TableListItem } from "./remote"

/** Searchable, viewport-aware selector for database tables and views. */
export const TableSelector = (props: { value: string, tables: TableListItem[], onChange: (value: string) => void, onContextMenu: (event: JSXInternal.TargetedMouseEvent<HTMLButtonElement>) => void }) => {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [active, setActive] = useState(0)
    const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 240 })
    const trigger = useRef<HTMLButtonElement>(null)
    const popup = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLInputElement>(null)
    const filtered = [...props.tables].sort((a, b) => a.name.localeCompare(b.name)).filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

    useLayoutEffect(() => {
        if (!open || !trigger.current) { return }
        const place = () => {
            const rect = trigger.current!.getBoundingClientRect()
            const margin = 8, gap = 5, desired = 340
            const width = Math.min(desired, window.innerWidth - margin * 2)
            const below = window.innerHeight - rect.bottom - gap - margin
            const above = rect.top - gap - margin
            const useAbove = below < 220 && above > below
            const available = Math.max(0, useAbove ? above : below)
            const height = Math.min(350, available)
            setPosition({ left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), top: useAbove ? rect.top - gap - height : rect.bottom + gap, width, maxHeight: height })
        }
        place()
        window.addEventListener("resize", place)
        window.addEventListener("scroll", place, true)
        input.current?.focus()
        return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true) }
    }, [open])

    useEffect(() => {
        if (!open) { return }
        const outside = (event: MouseEvent) => {
            if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) { setOpen(false) }
        }
        document.addEventListener("pointerdown", outside)
        return () => document.removeEventListener("pointerdown", outside)
    }, [open])

    useLayoutEffect(() => {
        if (open) { popup.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" }) }
    }, [active, open])

    const close = () => { setOpen(false); trigger.current?.focus() }
    const choose = (name: string) => { close(); if (name !== props.value) { props.onChange(name) } }
    const show = () => {
        setQuery("")
        const sorted = [...props.tables].sort((a, b) => a.name.localeCompare(b.name))
        setActive(Math.max(0, sorted.findIndex((item) => item.name === props.value)))
        setOpen(true)
    }
    return <span class="table-selector">
        <button type="button" ref={trigger} class="table-selector-trigger" data-testid="table-name" aria-label={`Select table, current: ${props.value}`} aria-haspopup="listbox" aria-expanded={open} onContextMenu={props.onContextMenu} onClick={() => open ? close() : show()}>
            <span>{props.value}</span><span aria-hidden="true">⌄</span>
        </button>
        {open && <div ref={popup} class="table-selector-popup" style={{ left: position.left, top: position.top, width: position.width, height: position.maxHeight }}>
            <div class="table-selector-search"><input ref={input} value={query} placeholder="Search tables or views…" aria-label="Search tables or views" role="combobox" aria-expanded="true" aria-controls="table-selector-list" aria-activedescendant={filtered[active] ? `table-option-${active}` : undefined} onInput={(event) => { setQuery(event.currentTarget.value); setActive(0) }} onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
                else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (filtered.length) { setActive((active + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length) } }
                else if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active]!.name) }
            }} /></div>
            <div class="table-selector-count" role="status">{query.trim() ? `${filtered.length} matching` : `${filtered.length} tables and views`}</div>
            <div class="table-selector-list" id="table-selector-list" role="listbox" aria-label="Tables and views">
                {filtered.length === 0 ? <div class="table-selector-empty">No matching tables or views</div> : filtered.map((item, i) => <button type="button" id={`table-option-${i}`} role="option" aria-selected={item.name === props.value} data-active={i === active} class="table-selector-option" onMouseMove={() => setActive(i)} onClick={() => choose(item.name)} key={item.name}><span aria-hidden="true">▦</span><span class="table-selector-name" title={item.name}>{item.name}</span><span class="table-selector-kind">{item.type === "view" ? "view" : ""}</span><span aria-hidden="true">{item.name === props.value ? "✓" : ""}</span></button>)}
            </div>
            <div class="table-selector-footer">↑ ↓ Select　 Enter Open <span>Esc Close</span></div>
        </div>}
    </span>
}
