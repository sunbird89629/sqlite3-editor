import * as remote from "./remote"

/** Everything that differs from one SQL dialect to another. This build speaks MySQL only. */

export type TableListItem = { name: string, type: "table" | "view" }
export type ColumnInfo = { name: string, type: string, nullable: boolean, default: string | null, primaryKey: boolean, autoIncrement: boolean }
export type IndexInfo = { name: string, unique: boolean, columns: string[] }

export const escapeIdentifier = (ident: string) => {
    if (ident.includes("\x00")) { throw new Error("Invalid identifier") }
    return `\`${ident.replaceAll("`", "``")}\``
}

export const identList = (names: readonly string[]) => names.map(escapeIdentifier).join(", ")

/** Lists the tables and views of the current database. */
export const getTableList = async (opts: remote.PostOptions = {}): Promise<TableListItem[]> => {
    const result = await remote.query(
        "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
        [], opts)
    return (result?.records ?? []).map((record) => ({ name: String(record.name), type: record.type === "VIEW" ? "view" : "table" }))
}

/** Reads the column definitions of one table. */
export const getColumns = async (table: string, opts: remote.PostOptions = {}): Promise<ColumnInfo[]> => {
    const result = await remote.query(
        "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt_value, COLUMN_KEY AS column_key, EXTRA AS extra " +
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
        [table], opts)
    return (result?.records ?? []).map((record) => ({
        name: String(record.name),
        type: String(record.type ?? ""),
        nullable: record.nullable === "YES",
        default: record.dflt_value === null || record.dflt_value === undefined ? null : String(record.dflt_value),
        primaryKey: record.column_key === "PRI",
        autoIncrement: String(record.extra ?? "").toLowerCase().includes("auto_increment"),
    }))
}

/** Reads the indexes of one table, in index order. */
export const getIndexes = async (table: string, opts: remote.PostOptions = {}): Promise<IndexInfo[]> => {
    const result = await remote.query(
        "SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name " +
        "FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        [table], opts)
    const indexes = new Map<string, IndexInfo>()
    for (const record of result?.records ?? []) {
        const name = String(record.name)
        const index = indexes.get(name) ?? { name, unique: Number(record.non_unique) === 0, columns: [] }
        index.columns.push(String(record.column_name))
        indexes.set(name, index)
    }
    return [...indexes.values()]
}

/** Retrieves `SHOW CREATE TABLE`, which carries the column definitions and the indexes. */
export const getTableSchema = async (table: string, opts: remote.PostOptions = {}): Promise<string | null> => {
    const result = await remote.query(`SHOW CREATE TABLE ${escapeIdentifier(table)}`, [], opts)
    return (result?.records[0]?.["Create Table"] as string | undefined) ?? null
}

/** The single column that identifies a row, or `null` when the table has no single-column primary key. */
export const rowKeyColumn = (columns: readonly ColumnInfo[]): string | null => {
    const primary = columns.filter((column) => column.primaryKey)
    return primary.length === 1 ? primary[0]!.name : null
}

/**
 * Long text and JSON columns are read as a prefix only. A page of 10 rows of `longtext` can easily
 * weigh megabytes, which dominates the query time; the full value is fetched when the user asks for it.
 */
export const PREVIEW_CHARS = 1024
export type Previewable = { name: string, type: string }
export const isPreviewed = (column: Previewable) => /text|json/i.test(column.type)

/** `LEFT(col, PREVIEW_CHARS) AS col`, or the plain column when it is small enough to read whole. */
export const selectExpression = (column: Previewable): string =>
    isPreviewed(column) ? `LEFT(${escapeIdentifier(column.name)}, ${PREVIEW_CHARS}) AS ${escapeIdentifier(column.name)}` : escapeIdentifier(column.name)

/** Reads one full value for the snapshot, addressed by the row key when there is one. */
export const fullValueSQL = (opts: {
    subquery: string
    column: string
    filterSQL: string
    order: string
    rowKey: string | null
}): string => {
    const column = `${escapeIdentifier(opts.column)} AS value`
    if (opts.rowKey !== null) {
        const conditions = opts.filterSQL === "" ? `${escapeIdentifier(opts.rowKey)} = ?` : `${opts.filterSQL} AND ${escapeIdentifier(opts.rowKey)} = ?`
        return `SELECT ${column} FROM ${opts.subquery} WHERE ${conditions} LIMIT 1`
    }
    // No row key: the page query itself is reproduced with an absolute offset.
    const where = opts.filterSQL === "" ? "" : ` WHERE ${opts.filterSQL}`
    return `SELECT ${column} FROM ${opts.subquery}${where}${opts.order} LIMIT 1 OFFSET ?`
}

/** Escapes a filter term for `LIKE`, where backslash is the default escape character. */
const escapeLike = (term: string) => term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

/** Case-insensitive substring match across every column, evaluated by the database. */
export const filterClause = (columns: readonly ColumnInfo[], term: string): { sql: string, params: string[] } => {
    const trimmed = term.trim()
    if (trimmed === "" || columns.length === 0) { return { sql: "", params: [] } }
    const sql = "(" + columns.map(({ name }) => `CAST(${escapeIdentifier(name)} AS CHAR) LIKE ?`).join(" OR ") + ")"
    return { sql, params: columns.map(() => `%${escapeLike(trimmed)}%`) }
}

/** `ORDER BY` for the requested column, keeping the row key as the tie breaker. */
export const orderClause = (sort: { column: string, direction: "asc" | "desc" } | null, columns: readonly ColumnInfo[], rowKey: string | null): string => {
    if (sort === null) { return rowKey === null ? "" : ` ORDER BY ${escapeIdentifier(rowKey)}` }
    if (!columns.some((column) => column.name === sort.column)) { return rowKey === null ? "" : ` ORDER BY ${escapeIdentifier(rowKey)}` }
    const tieBreaker = rowKey !== null && sort.column !== rowKey ? `, ${escapeIdentifier(rowKey)}` : ""
    return ` ORDER BY ${escapeIdentifier(sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}${tieBreaker}`
}
