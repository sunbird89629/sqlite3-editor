import { useRef, useMemo, useState, useEffect } from "preact/hooks"
import * as remote from "./remote"
import { persistentRef, renderContextmenu } from "./components"
import { BigintMath, createStore } from "./util"
import deepEqual from "fast-deep-equal"
import { escapeIdentifier, filterClause, fullValueSQL, getColumns, getIndexes, getTableList, getTableSchema, identList, isPreviewed, orderClause, rowKeyColumn, selectExpression } from "./dialect"
import type { ColumnInfo, IndexInfo, TableListItem } from "./dialect"

export const PAGE_SIZE = 10n
export const pageCount = (count: bigint) => (count + PAGE_SIZE - 1n) / PAGE_SIZE
export const pageOffset = (top: bigint, count: bigint) => {
    const last = count > 0n ? (pageCount(count) - 1n) * PAGE_SIZE : 0n
    return BigintMath.max(0n, BigintMath.min(last, (top / PAGE_SIZE) * PAGE_SIZE))
}

export const useTableStore = createStore("useTableStore", {
    paging: {
        /** scrollTop */
        visibleAreaTop: 0n,
        /** the number of records in the table */
        numRecords: 0n,
        /** the number of rows visible at a time */
        visibleAreaSize: PAGE_SIZE,
    },
    /** error messages */
    errorMessage: "",
    /** a custom query `customViewerQuery` instead of "SELECT * FROM tableName" is used for the viewer if true */
    useCustomViewerQuery: false,
    /** a custom query for the viewer */
    customViewerQuery: "",
    /** Orders the viewer rows by this column when set. `null` keeps the natural order (row key or the order of the custom query). */
    sort: null as { column: string, direction: "asc" | "desc" } | null,
    /** Case-insensitive text filter matched against every column of the viewer. Applied by the database, not in the browser. */
    filter: "",
    /** True while the viewer is fetching rows, so that the UI can show progress and disable navigation. */
    viewerLoading: false,
    /** True when the displayed rows come from the last successful query after a failed one. */
    viewerStale: false,
    /** A statement that the query editor should show without running it (used by menu commands). */
    pendingQuery: null as string | null,
    /** The cell selected in the viewer. Selection never enables editing. */
    selectedCell: null as { row: number, column: string } | null,
    _rerender: {} as Record<string, never>,
    /** the list of tables in the database */
    tableList: [] as TableListItem[],
    /** the name of the active table */
    tableName: undefined as string | undefined,
    /** the columns to be queried, sorted by their position in the table. */
    visibleColumns: [] as string[],
    /** error messages of the viewer */
    invalidQuery: null as string | null,
    /** the list of columns in the table */
    columns: [] as ColumnInfo[],
    indexList: [] as IndexInfo[],
    tableSchema: null as string | null,
    /** The database this session is attached to, shown in the query history. */
    sessionDatabase: "",
    /** The single column that identifies a row; `null` when the table has no single-column primary key. */
    rowKeyColumn: null as string | null,
    /** Text columns whose values were read as a prefix only; the full value is fetched on demand. */
    truncatedColumns: [] as string[],
    /** Represents whether the active table has an AUTO_INCREMENT column. */
    autoIncrement: false,
    /** the records in the visible area */
    records: [] as readonly { readonly [key in string]: Readonly<remote.MySqlValue> }[],
}, (set, get) => {
    let reloadGeneration = 0
    let schemaTable: string | undefined
    let pageSnapshot: { subquery: string, top: bigint, records: readonly Record<string, remote.MySqlValue>[] } | null = null
    /** Everything needed to re-read one cell value: the same subquery, filter and order as the page. */
    let pageContext: { subquery: string, filterSQL: string, filterParams: remote.MySqlValue[], order: string, rowKey: string | null } | null = null
    /** Resets the viewer to the "nothing to show" state (no table selected, or no custom query typed yet). */
    const clearViewer = () => {
        const { paging } = get()
        pageSnapshot = null
        set({ invalidQuery: null, viewerStale: false, selectedCell: null, records: [], columns: [], visibleColumns: [], paging: { ...paging, numRecords: 0n, visibleAreaTop: 0n } })
    }
    /** Queries the visible area of the table or of the custom query. */
    const reloadTable = async (reloadSchema: boolean, reloadRecordCount: boolean) => {
        const generation = ++reloadGeneration
        set({ viewerLoading: true })
        try {
            const state = get()

            /** The table name, or a subquery if using a custom query. */
            let subquery: string
            /** The list of columns of the current result. */
            let columns: ColumnInfo[]
            /** The single column that identifies a row of the current result. */
            let rowKey: string | null
            if (!state.useCustomViewerQuery) {
                if (state.tableName === undefined) { clearViewer(); return }
                subquery = escapeIdentifier(state.tableName)
                columns = !reloadSchema ? state.columns : await getColumns(state.tableName, { withoutLogging: true })
                rowKey = !reloadSchema ? state.rowKeyColumn : rowKeyColumn(columns)
                if (columns.length === 0) { clearViewer(); return }
            } else {
                if (state.customViewerQuery.trim() === "") { clearViewer(); return }
                // MySQL requires an alias on every derived table.
                subquery = `(${state.customViewerQuery}) AS viewer_query`
                rowKey = null
                columns = !reloadSchema ? state.columns : (await remote.query(`SELECT * FROM ${subquery} LIMIT 0`, [], { withoutLogging: true }))?.columns.map((name): ColumnInfo => ({ name, type: "", nullable: true, default: null, primaryKey: false, autoIncrement: false })) ?? []
            }

            const retainedColumns = reloadSchema && !state.useCustomViewerQuery && state.tableName === schemaTable ? state.visibleColumns.filter((name) => columns.some((column) => column.name === name)) : []
            const selectedColumns = retainedColumns.length ? retainedColumns : columns.map(({ name }) => name)

            // Filtering happens in the database so that it applies to the whole result, not just the visible page.
            const activeColumns = (!state.useCustomViewerQuery ? columns : state.columns).filter((column) => selectedColumns.includes(column.name))
            const filter = filterClause(activeColumns.length ? activeColumns : columns, state.filter)
            // Sorting also happens in the database so that page 2 continues where page 1 ended.
            const sort = state.sort !== null && columns.some((column) => column.name === state.sort!.column) ? state.sort : null
            const order = orderClause(sort, columns, rowKey)

            if (reloadSchema || reloadRecordCount) { pageSnapshot = null }
            if (generation !== reloadGeneration) { return }
            if (reloadRecordCount) {
                const where = filter.sql === "" ? "" : ` WHERE ${filter.sql}`
                const counted = (await remote.query(`SELECT COUNT(*) AS count FROM ${subquery}${where}`, filter.params, { withoutLogging: true }))?.records[0]?.count
                if (generation !== reloadGeneration) { return }
                const numRecords = typeof counted === "bigint" ? counted : BigInt(Number(counted ?? 0))
                await setPaging({ numRecords }, true)
            }

            const current = get()
            // The anchor optimization only holds while the rows are ordered by the row key.
            const delta = pageSnapshot ? current.paging.visibleAreaTop - pageSnapshot.top : 0n
            const anchor = sort === null && rowKey !== null && pageSnapshot && pageSnapshot.subquery === subquery && delta > 0n && delta <= BigInt(pageSnapshot.records.length)
                ? pageSnapshot.records[Number(delta - 1n)]?.[rowKey]
                : undefined
            const useAnchor = anchor !== undefined && anchor !== null
            const conditions: string[] = []
            const params: remote.MySqlValue[] = []
            if (filter.sql !== "") { conditions.push(filter.sql); params.push(...filter.params) }
            if (useAnchor) { conditions.push(`${escapeIdentifier(rowKey!)} > ?`); params.push(anchor as remote.MySqlValue) }
            const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`
            // Long text columns are read as a prefix: a page of 10 `longtext` values can weigh megabytes.
            const chosen = reloadSchema ? selectedColumns : getVisibleColumns()
            const columnByName = new Map(columns.map((column) => [column.name, column]))
            const expressions = chosen.map((name) => selectExpression(columnByName.get(name) ?? { name, type: "" }))
            const truncated = chosen.filter((name) => isPreviewed(columnByName.get(name) ?? { name, type: "" }))
            const selected = `SELECT ${rowKey !== null && !chosen.includes(rowKey) ? `${escapeIdentifier(rowKey)}, ` : ""}${expressions.join(", ")} FROM ${subquery}${where}${order} LIMIT ?${useAnchor ? "" : " OFFSET ?"}`
            const records = (await remote.query(selected, [...params, current.paging.visibleAreaSize, ...(useAnchor ? [] : [current.paging.visibleAreaTop])], { withoutLogging: true, coalesceKey: reloadSchema || reloadRecordCount ? undefined : "visible-page" }))?.records ?? []
            if (generation !== reloadGeneration) { return }
            pageSnapshot = { subquery, top: current.paging.visibleAreaTop, records }
            pageContext = { subquery, filterSQL: filter.sql, filterParams: filter.params, order, rowKey }

            if (!reloadSchema) {
                set({ records, rowKeyColumn: rowKey, columns, truncatedColumns: truncated, invalidQuery: null, viewerStale: false, selectedCell: null })
            } else if (!state.useCustomViewerQuery) {
                const indexList = await getIndexes(state.tableName!, { withoutLogging: true })
                const tableSchema = await getTableSchema(state.tableName!, { withoutLogging: true })
                if (generation !== reloadGeneration) { return }
                schemaTable = state.tableName
                set({
                    invalidQuery: null,
                    viewerStale: false,
                    columns,
                    visibleColumns: selectedColumns,
                    records,
                    rowKeyColumn: rowKey,
                    truncatedColumns: truncated,
                    autoIncrement: columns.some((column) => column.autoIncrement),
                    tableSchema,
                    indexList,
                })
            } else {
                schemaTable = undefined
                set({
                    invalidQuery: null,
                    viewerStale: false,
                    columns,
                    visibleColumns: columns.map(({ name }) => name),
                    records,
                    rowKeyColumn: rowKey,
                    truncatedColumns: truncated,
                    autoIncrement: false,
                    tableSchema: null,
                    indexList: [],
                })
            }
        } catch (err) {
            if (generation !== reloadGeneration) { return }
            // Keep the rows that are still displayed; mark them as a previous result.
            set({
                invalidQuery: typeof err === "object" && err !== null && "message" in err ? err.message + "" : err + "",
                viewerStale: get().records.length > 0,
            })
            throw err
        } finally {
            // A newer request keeps the indicator visible until it finishes.
            if (generation === reloadGeneration) { set({ viewerLoading: false }) }
        }
    }
    const setViewerQuery = async (opts: {
        useCustomViewerQuery?: boolean
        customViewerQuery?: string
        tableName?: string
    }) => {
        const previous = get()
        const changed = (opts.tableName !== undefined && opts.tableName !== previous.tableName)
            || (opts.useCustomViewerQuery !== undefined && opts.useCustomViewerQuery !== previous.useCustomViewerQuery)
            || (opts.customViewerQuery !== undefined && opts.customViewerQuery !== previous.customViewerQuery)
        // Sorting refers to columns of the previous result, so it is dropped when the data source changes.
        set(changed ? { ...opts, sort: null, paging: { ...previous.paging, visibleAreaTop: 0n } } : opts)
        await remote.setState("tableName", get().tableName)
        await reloadTable(true, true)
    }
    const setPaging = async (opts: { visibleAreaTop?: bigint, numRecords?: bigint, visibleAreaSize?: bigint }, withoutTableReloading?: true) => {
        let paging = { ...get().paging, ...opts }
        paging.visibleAreaSize = PAGE_SIZE
        paging.visibleAreaTop = pageOffset(paging.visibleAreaTop, paging.numRecords)
        if (deepEqual(get().paging, paging)) { return }
        // Update paging before querying the database. Otherwise the scrollbar will vibrate.
        set({ paging })
        if (!withoutTableReloading) {
            await reloadTable(false, false)
        }
    }
    /** Puts a statement into the query editor without running it. */
    const seedQuery = async (query: string) => {
        set({ pendingQuery: query })
        await setViewerQuery({ useCustomViewerQuery: true })
    }
    /** Orders the viewer rows by the given column in the database, or restores the natural order when null. */
    const setSort = async (sort: { column: string, direction: "asc" | "desc" } | null) => {
        set({ sort, paging: { ...get().paging, visibleAreaTop: 0n } })
        await reloadTable(false, false)
    }
    /** Filters the viewer rows in the database so that the filter applies to the whole result, not to one page. */
    const setFilter = async (filter: string) => {
        if (filter === get().filter) { return }
        set({ filter, paging: { ...get().paging, visibleAreaTop: 0n } })
        await reloadTable(false, true)
    }
    const getVisibleColumns = () => get().visibleColumns
    /** Re-reads one cell at full length, using the row key when there is one and the page offset otherwise. */
    const readFullValue = async (rowIndex: number, column: string, record: Record<string, remote.MySqlValue>): Promise<remote.MySqlValue> => {
        if (pageContext === null) { throw new Error("The page is not loaded") }
        const key = pageContext.rowKey
        const keyed = key !== null && record[key] !== undefined
        const sql = fullValueSQL({
            subquery: pageContext.subquery,
            column,
            filterSQL: pageContext.filterSQL,
            order: pageContext.order,
            rowKey: keyed ? key : null,
        })
        const params = keyed
            ? [...pageContext.filterParams, record[key!] as remote.MySqlValue]
            : [...pageContext.filterParams, Number(get().paging.visibleAreaTop) + rowIndex]
        const result = await remote.query(sql, params, { withoutLogging: true })
        return (result?.records[0]?.value ?? null) as remote.MySqlValue
    }
    /** Render visibleColumns to be embedded in SQL queries. */
    const getVisibleColumnsSQL = () => {
        const { columns, visibleColumns } = get()
        return identList(columns.length === visibleColumns.length ? columns.map(({ name }) => name) : visibleColumns) || "1"
    }
    return {
        setViewerQuery,
        readFullValue,
        seedQuery,
        setSort,
        setFilter,
        reloadTable,
        setPaging,
        getVisibleColumnsSQL,
        setVisibleColumns: async (columns: string[]) => {
            if (columns.length === 0) { throw new Error() }
            const { columns: all, sort } = get()
            columns = [...new Set(columns)]  // remove duplicates
            if (columns.some((column) => !all.find((v) => v.name === column))) { throw new Error() }
            // A hidden column cannot stay the sort key, or the order would look unexplained.
            const sortAfter = sort !== null && !columns.includes(sort.column) ? null : sort
            set({
                visibleColumns: columns.sort((a, b) => all.findIndex((v) => v.name === a) - all.findIndex((v) => v.name === b)),
                ...(sortAfter !== sort ? { sort: null } : {}),
            })
            await reloadTable(false, false)
        },
        getPageMax: () => pageCount(get().paging.numRecords),
        rerender: () => set({ _rerender: {} }),
        addErrorMessage: (value: string) => set((s) => ({ errorMessage: s.errorMessage + value + "\n" })),
        /** Reloads the table list and the visible rows. This is the only refresh path: the session does not poll. */
        reloadAllTables: async (selectTable?: string) => {
            const state = get()
            const newTableList = await getTableList()
            if (!deepEqual(newTableList, state.tableList)) {
                let newTableName = selectTable ?? state.tableName
                if (!newTableList.some((table) => table.name === newTableName)) {
                    newTableName = newTableList[0]?.name
                }
                set({ tableList: newTableList })
                await setViewerQuery({ tableName: newTableName })
            } else {
                await reloadTable(true, true)
            }
        },
    }
})

export const Table = () => {
    const tableName = useTableStore((s) => s.tableName)
    const visibleAreaTop = useTableStore((s) => s.paging.visibleAreaTop)
    const visibleAreaSize = useTableStore((s) => Number(s.paging.visibleAreaSize))
    const numRecords = useTableStore((s) => s.paging.numRecords)
    const sort = useTableStore((s) => s.sort)
    const setSort = useTableStore((s) => s.setSort)
    const viewerLoading = useTableStore((s) => s.viewerLoading)
    const columns = useTableStore((s) => s.columns)
    const autoIncrement = useTableStore((s) => s.autoIncrement)
    const records = useTableStore((s) => s.records)
    const setPaging = useTableStore((s) => s.setPaging)
    const visibleColumns = useTableStore((s) => s.visibleColumns)
    const setVisibleColumns = useTableStore((s) => s.setVisibleColumns)
    const rowKey = useTableStore((s) => s.rowKeyColumn)

    const [previewSelection, setPreviewSelection] = useState<{ table: string | undefined, query: string, page: bigint, row: number, record: typeof records[number] } | null>(null)
    const previewQuery = useTableStore((s) => s.useCustomViewerQuery ? s.customViewerQuery : "")

    const columnWidthCaches = persistentRef<Record<string, (number | undefined | null)[]>>("columnWidths_v4", {})
    const getColumnWidths = () => {
        const result: number[] = []
        for (let i = 0; i < columns.length; i++) {
            result.push(columnWidthCaches.current[tableName ?? ""]?.[i] ?? (columns.length === 1 ? 250 : 150))
        }
        return result
    }
    const tableRef = useRef<HTMLTableElement>(null)

    const tableType = useTableStore((s) => s.tableList.find(({ name }) => name === s.tableName)?.type)
    /** True while the pointer is dragging a column border, so that the click that ends the drag does not sort. */
    const resized = useRef(false)

    const showSkeleton = viewerLoading && records.length === 0

    return <>
        <div class={"max-w-full overflow-x-auto w-max" + (viewerLoading && !showSkeleton ? " viewer-refreshing" : "")} >
            {/* Table */}
            <table ref={tableRef} class="viewer w-max border-collapse table-fixed bg-white [box-shadow:0_0_0px_2px_#000000ad]" data-testid="viewer-table" aria-busy={viewerLoading}>
                {/* Table Header */}
                <thead class="text-black bg-[var(--gutter-color)] [outline:rgb(181,181,181)_1px_solid]">
                    <tr>
                        <th class="font-normal select-none pt-[3px] pb-[3px] pl-[1em] pr-[1em]"></th>
                        {columns.filter((v) => visibleColumns.includes(v.name)).map(({ name, type, nullable, default: defaultValue, primaryKey, autoIncrement: isAutoIncrement }, i) => <th
                            style={{ width: getColumnWidths()[i]! }}
                            class={"font-normal select-none clickable" + (sort?.column === name ? " sorted" : "")}
                            title={`Sort by ${name}`}
                            aria-sort={sort?.column === name ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                            onClick={() => {
                                if (resized.current) { resized.current = false; return }
                                setSort(sort?.column === name ? (sort.direction === "asc" ? { column: name, direction: "desc" } : null) : { column: name, direction: "asc" }).catch(console.error)
                            }}
                            onMouseMove={(ev) => {
                                const rect = ev.currentTarget.getBoundingClientRect()
                                if (rect.right - ev.clientX < 20) {
                                    ev.currentTarget.classList.add("ew-resize")
                                } else {
                                    ev.currentTarget.classList.remove("ew-resize")
                                }
                            }}
                            onMouseDown={(ev) => {
                                if (ev.button === 2) { return } // right click

                                const th = ev.currentTarget
                                const rect = th.getBoundingClientRect()
                                if (rect.right - ev.clientX < 20) {
                                    resized.current = true
                                    const mouseMove = (ev: MouseEvent) => {
                                        const widths = [...(columnWidthCaches.current[tableName ?? ""] ?? [])]
                                        widths[i] = Math.max(50, ev.clientX - rect.left)
                                        columnWidthCaches.current = { ...columnWidthCaches.current, [tableName ?? ""]: widths }
                                        th.style.width = widths[i]! + "px"
                                        for (const td of tableRef.current?.querySelectorAll<HTMLElement>(`td:nth-child(${i + 2})`) ?? []) {
                                            td.style.maxWidth = widths[i]! + "px"
                                        }
                                    }
                                    document.body.classList.add("ew-resize")
                                    window.addEventListener("mousemove", mouseMove)
                                    window.addEventListener("mouseup", () => {
                                        window.removeEventListener("mousemove", mouseMove)
                                        document.body.classList.remove("ew-resize")
                                        // The click event fires after mouseup; keep the flag for one turn.
                                        setTimeout(() => { resized.current = false }, 0)
                                    }, { once: true })
                                }
                            }}
                            onMouseLeave={(ev) => {
                                ev.currentTarget.classList.remove("ew-resize")
                            }}
                            onContextMenu={(ev) => {
                                renderContextmenu(ev, <>
                                    <button onClick={() => { setSort({ column: name, direction: "asc" }).catch(console.error) }}>Sort Ascending</button>
                                    <button onClick={() => { setSort({ column: name, direction: "desc" }).catch(console.error) }}>Sort Descending</button>
                                    {sort?.column === name && <button onClick={() => { setSort(null).catch(console.error) }}>Clear Sort</button>}
                                    <hr />
                                    <button disabled={visibleColumns.length === 1} onClick={async () => {
                                        await setVisibleColumns(visibleColumns.filter((v) => v !== name))
                                    }}>Hide</button>
                                    <hr />
                                    <button onClick={() => navigator.clipboard.writeText(name)}>Copy Column Name</button>
                                </>)
                            }}>
                            <code class="inline-block [word-break:break-word] [color:inherit] [font-family:inherit] [font-size:inherit]">
                                {name}
                                <span class="italic opacity-70">
                                    {!!type && <span> {type}</span>}
                                    {!nullable && <span> NOT NULL</span>}
                                    {defaultValue !== null && <span> DEFAULT {defaultValue}</span>}
                                    {primaryKey && <span> {isAutoIncrement ? <>PRIMARY KEY AUTO_INCREMENT</> : <>PRIMARY KEY</>}</span>}
                                </span>
                            </code>
                            {sort?.column === name && <span class="ml-1 text-primary-highlight" aria-hidden="true">{sort.direction === "asc" ? "▲" : "▼"}</span>}
                        </th>)}
                    </tr>
                </thead>

                {/* Table Body */}
                <tbody>
                    {/* Loading placeholders, only while there is nothing to show yet. */}
                    {showSkeleton && Array.from({ length: 10 }, (_, row) => <tr class="viewer-skeleton" key={"skeleton" + row}>
                        <td colSpan={visibleColumns.length + 1}><i></i></td>
                    </tr>)}

                    {/* Rows */}
                    {!showSkeleton && records.map((record, row) => <TableRow selected={previewSelection !== null && previewSelection.table === tableName && previewSelection.query === previewQuery && previewSelection.page === visibleAreaTop && previewSelection.row === row && previewSelection.record === record} onPreview={() => setPreviewSelection({ table: tableName, query: previewQuery, page: visibleAreaTop, row, record })} key={row} row={row} record={record} columnWidths={getColumnWidths()} rowNumber={visibleAreaTop + BigInt(row) + 1n} rowKey={rowKey} />)}

                    {/* Margin */}
                    {/* NOTE: `visibleAreaSize - records.length` can be negative while resizing the table. */}
                    {!showSkeleton && Array(Math.max(0, visibleAreaSize - records.length)).fill(0).map((_, row) => <EmptyTableRow key={row} columnWidths={getColumnWidths()} rowNumber={visibleAreaTop + BigInt(records.length + row) + 1n} />)}
                </tbody>
            </table>
        </div>

        <nav class="data-pagination" aria-label="Data pagination">
            <button type="button" disabled={viewerLoading || visibleAreaTop === 0n} onClick={() => { setPaging({ visibleAreaTop: visibleAreaTop - PAGE_SIZE }).catch(console.error) }}>Previous</button>
            <span class="data-pagination-page">Page <PageInput
                page={numRecords === 0n ? 0n : visibleAreaTop / PAGE_SIZE + 1n}
                totalPages={pageCount(numRecords)}
                disabled={viewerLoading || numRecords === 0n}
                onJump={(page) => { setPaging({ visibleAreaTop: (page - 1n) * PAGE_SIZE }).catch(console.error) }} /><span aria-hidden="true"> / </span><span data-testid="page-indicator">{pageCount(numRecords).toString()}</span></span>
            <button type="button" disabled={viewerLoading || visibleAreaTop + PAGE_SIZE >= numRecords} onClick={() => { setPaging({ visibleAreaTop: visibleAreaTop + PAGE_SIZE }).catch(console.error) }}>Next</button>
            <span class="data-pagination-range">{numRecords === 0n ? "No records" : `Rows ${visibleAreaTop + 1n}–${visibleAreaTop + BigInt(records.length)}`}</span>
        </nav>
    </>
}

/** Page number input; commits on Enter or blur so that typing does not reload the viewer on every key. */
const PageInput = (props: { page: bigint, totalPages: bigint, disabled: boolean, onJump: (page: bigint) => void }) => {
    const [draft, setDraft] = useState(props.page.toString())
    useEffect(() => { setDraft(props.page.toString()) }, [props.page])
    const commit = () => {
        let value = /^\d+$/.test(draft) ? BigInt(draft) : 1n
        value = BigintMath.max(1n, BigintMath.min(BigintMath.max(1n, props.totalPages), value))
        setDraft(value.toString())
        if (value !== props.page) { props.onJump(value) }
    }
    return <input
        class="data-pagination-input"
        data-testid="page-input"
        aria-label="Go to page"
        inputMode="numeric"
        disabled={props.disabled}
        value={draft}
        onChange={(ev) => setDraft(ev.currentTarget.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit() } }}
    />
}

/** Plain-text form of a cell value, used by the read-only snapshot and the clipboard. */
export const cellText = (value: remote.MySqlValue): string =>
    value instanceof Uint8Array ? `0x${blob2hex(value)}` : value === null ? "NULL" : String(value)

/**
 * Reads the whole value of one cell. The page only carries a prefix for long text columns, so the
 * full value is fetched on demand; on failure the prefix is returned and the error is shown.
 */
export const readCellValue = async (value: remote.MySqlValue, column: string, rowIndex: number, record: Record<string, remote.MySqlValue>): Promise<remote.MySqlValue> => {
    const state = useTableStore.getState()
    if (!state.truncatedColumns.includes(column)) { return value }
    try {
        return await state.readFullValue(rowIndex, column, record)
    } catch (err) {
        state.addErrorMessage(`Could not read the full value: ${err instanceof Error ? err.message : String(err)}\n`)
        return value
    }
}

/**
 * Opens the full value in an editor tab (VS Code) or a new browser tab (development server).
 * The snapshot is read-only: there is no way to write it back.
 */
export const openValueSnapshot = async (value: remote.MySqlValue, column: string, rowIndex: number, record: Record<string, remote.MySqlValue>) => {
    const state = useTableStore.getState()
    const text = cellText(await readCellValue(value, column, rowIndex, record))
    if (remote.isVSCode) {
        const row = `row ${state.paging.visibleAreaTop + BigInt(rowIndex) + 1n}`
        void remote.openCellInEditor(text, column, state.tableName, row).catch(console.error)
        return
    }
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
    window.open(url, "_blank", "noopener")
    setTimeout(() => URL.revokeObjectURL(url), 60000)
}

const TableRow = (props: { selected: boolean, onPreview: () => void, readonly record: { readonly [key in string]: Readonly<remote.MySqlValue> }, rowNumber: bigint, row: number, columnWidths: readonly number[], rowKey: string | null }) => {
    const tableName = useTableStore((s) => s.tableName)
    const columns = useTableStore((s) => s.columns)
    const visibleColumns = useTableStore((s) => s.visibleColumns)
    const selectedCell = useTableStore((s) => s.selectedCell)

    const preview = async () => {
        const state = useTableStore.getState()
        // A page only carries a prefix of long text columns, so the row snapshot reads them in full.
        const record = Object.fromEntries(await Promise.all(columns.map(async ({ name }) => {
            if (!state.truncatedColumns.includes(name)) { return [name, props.record[name] as remote.MySqlValue] }
            try {
                return [name, await state.readFullValue(props.row, name, props.record as Record<string, remote.MySqlValue>)]
            } catch (err) {
                state.addErrorMessage(`Could not read ${name}: ${err instanceof Error ? err.message : String(err)}\n`)
                return [name, props.record[name] as remote.MySqlValue]
            }
        })))
        const content = JSON.stringify(record, (_key, value) => {
            if (typeof value === "bigint") { const number = Number(value); return Number.isSafeInteger(number) ? number : { type: "INTEGER", value: value.toString() } }
            if (value instanceof Uint8Array) { return { type: "BLOB", hex: blob2hex(value) } }
            return value
        }, 2)
        props.onPreview()
        if (remote.isVSCode) { remote.openRowInEditor(content, tableName, `row ${props.rowNumber}`).catch(console.error) }
        else {
            const url = URL.createObjectURL(new Blob([content], { type: "application/json" }))
            window.open(url, "_blank", "noopener")
            setTimeout(() => URL.revokeObjectURL(url), 60000)
        }
    }

    return useMemo(() => <tr class={props.selected ? "editing" : ""}>
        {/* Row number */}
        <td
            class="pl-[10px] pr-[10px] bg-[var(--gutter-color)] overflow-hidden sticky left-0 whitespace-nowrap text-right text-black select-none border-r-[1px] border-r-[var(--td-border-color)] clickable"
            role="button" tabIndex={0} aria-label={`Preview row ${props.rowNumber}`}
            onClick={() => { void preview() }}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); void preview() } }}
            onContextMenu={(ev) => {
                renderContextmenu(ev, <>
                    <button onClick={() => navigator.clipboard.writeText(props.rowNumber + "")}>Copy Row Number</button>
                    {props.rowKey && <button onClick={() => navigator.clipboard.writeText(props.record[props.rowKey!] + "")}>Copy {props.rowKey}</button>}
                </>)
            }}
            data-testid={`row number ${props.rowNumber}`}>{props.rowNumber}</td>

        {/* Cells */}
        {columns.filter((v) => visibleColumns.includes(v.name)).map(({ name }, i) => {
            const value = props.record[name] as remote.MySqlValue
            const isSelected = selectedCell?.row === props.row && selectedCell.column === name
            const select = (ev: MouseEvent) => {
                if (ev.button === 2) { return }
                ev.preventDefault()
                useTableStore.setState({ selectedCell: { row: props.row, column: name } })
                if (ev.currentTarget instanceof HTMLElement) { ev.currentTarget.focus() }
            }
            return <td
                class={"pl-[10px] pr-[10px] overflow-hidden border-r-[1px] border-[var(--td-border-color)] border-b-[1px] border-b-[var(--td-border-color)] clickable " + (isSelected ? "selected" : "")}
                style={{ maxWidth: props.columnWidths[i] }}
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                data-cell-selected={isSelected ? "true" : undefined}
                onMouseDown={select}
                onDblClick={() => { void openValueSnapshot(value, name, props.row, props.record) }}
                onContextMenu={(ev) => {
                    renderContextmenu(ev, <>
                        <button onClick={() => { void openValueSnapshot(value, name, props.row, props.record) }}>Open Value in Editor</button>
                        <hr />
                        <button onClick={async () => {
                            // Copying always takes the whole value, not the page prefix.
                            const full = await readCellValue(value, name, props.row, props.record)
                            navigator.clipboard.writeText(cellText(full)).catch(console.error)
                        }}>Copy Text</button>
                        <button onClick={async () => {
                            const full = await readCellValue(value, name, props.row, props.record)
                            navigator.clipboard.writeText(JSON.stringify(full)).catch(console.error)
                        }}>Copy JSON</button>
                    </>)
                }}
                data-testid={`cell ${props.rowNumber - 1n}, ${i}`}>
                <pre class="overflow-hidden text-ellipsis whitespace-nowrap max-w-[50em] [font-size:inherit]">
                    <span class="select-none"><CellValue value={value} /></span>
                </pre>
            </td>
        })}
    </tr>, [props.selected, props.onPreview, tableName, columns, visibleColumns, props.record, props.rowNumber, props.rowKey, selectedCell?.row, selectedCell?.column])  // excluded: props.columnWidth
}

/** Renders an empty row that is shown at the bottom of the table. */
const EmptyTableRow = (props: { rowNumber: bigint, columnWidths: readonly number[] }) => {
    const columns = useTableStore((s) => s.columns)
    const visibleColumns = useTableStore((s) => s.visibleColumns)

    return <tr>
        <td class="pl-[10px] pr-[10px] bg-[var(--gutter-color)] overflow-hidden sticky left-0 whitespace-nowrap text-center text-black select-none border-r-[1px] border-r-[var(--td-border-color)]">{""}</td>
        {columns.filter((v) => visibleColumns.includes(v.name)).map((_, i) => <td
            class="pl-[10px] pr-[10px] overflow-hidden border-r-[1px] border-r-[var(--td-border-color)] border-b-[1px] border-b-[var(--td-border-color)]"
            style={{ maxWidth: props.columnWidths[i] }}>
            <pre class="overflow-hidden text-ellipsis whitespace-nowrap max-w-[50em] [font-size:inherit] ">
                <span class="select-none">&nbsp;</span>
            </pre>
        </td>)}
    </tr>
}

export const blob2hex = (blob: Uint8Array, maxLength?: number) =>
    Array.from(blob.slice(0, maxLength), (x) => x.toString(16).padStart(2, "0")).join("") + (maxLength !== undefined && blob.length > maxLength ? "..." : "")

/** Renders a cell value: text with a bounded preview, binary as hex, NULL as NULL. */
export const CellValue = ({ value }: { value: remote.MySqlValue }) => {
    if (value instanceof Uint8Array) {  // BINARY / BLOB
        return <span class="text-[var(--data-null)]">{`0x${blob2hex(value, 8)}`}</span>
    } else if (value === null) {  // NULL
        return <span class="text-[var(--data-null)]">NULL</span>
    } else if (typeof value === "string") {
        // Only render a bounded preview; the original value remains available for copying.
        const limit = 512
        let end = Math.min(value.length, limit)
        if (end < value.length && end > 0 && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) { end-- }
        const preview = value.slice(0, end).replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\r", "\\r").replaceAll("\n", "\\n")
        return <span class="text-[var(--data-string)]">{(preview || /* nbsp */"\u00a0") + (end < value.length ? "…" : "")}</span>
    } else if (typeof value === "number") {
        return <span class="text-[var(--data-number)]">{`${value}`}</span>
    } else {
        return <span class="text-[var(--data-number)]">{"" + value}</span>
    }
}
