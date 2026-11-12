/** Pure helpers behind the SQL completion provider, kept free of the `vscode` API so they can be tested. */

export type SuggestionKind = "column" | "table" | "keyword"
export type Suggestion = { label: string, kind: SuggestionKind, detail?: string }

/** A compact MySQL 8 keyword list: the words that are worth completing, not the full reserved set. */
export const MYSQL_KEYWORDS: readonly string[] = [
    "ALL", "ALTER", "ANALYZE", "AND", "AS", "ASC", "AUTO_INCREMENT", "BETWEEN", "BLOB", "BOTH", "BY",
    "CASCADE", "CASE", "CAST", "CHAR", "CHARACTER", "CHARSET", "COALESCE", "COLLATE", "COLUMN", "COLUMNS",
    "COMMENT", "CONCAT", "CONSTRAINT", "CONVERT", "COUNT", "CREATE", "CROSS", "CURRENT_DATE", "CURRENT_TIME",
    "CURRENT_TIMESTAMP", "CURRENT_USER", "DATABASE", "DATABASES", "DATE", "DATETIME", "DECIMAL", "DEFAULT",
    "DELETE", "DESC", "DESCRIBE", "DISTINCT", "DISTINCTROW", "DIV", "DOUBLE", "DROP", "DUPLICATE", "ELSE",
    "END", "ENGINE", "ESCAPE", "EXISTS", "EXPLAIN", "FALSE", "FIELDS", "FLOAT", "FOR", "FORCE", "FOREIGN",
    "FROM", "FULLTEXT", "GROUP", "HAVING", "IF", "IFNULL", "IGNORE", "IN", "INDEX", "INNER", "INSERT",
    "INT", "INTEGER", "INTERVAL", "INTO", "IS", "JOIN", "JSON", "KEY", "LEADING", "LEFT", "LIKE", "LIMIT",
    "LONGTEXT", "MATCH", "MAX", "MIN", "MOD", "NATURAL", "NOT", "NOW", "NULL", "NULLS", "NUMERIC", "OFFSET",
    "ON", "OR", "ORDER", "OUTER", "PRIMARY", "PROCEDURE", "RENAME", "REPLACE", "REVOKE", "RIGHT", "RLIKE",
    "ROLLUP", "ROW", "ROWS", "SELECT", "SEPARATOR", "SET", "SHOW", "SMALLINT", "START", "STRAIGHT_JOIN",
    "SUBSTRING", "SUM", "TABLE", "TABLES", "TEMPORARY", "TEXT", "THEN", "TINYINT", "TO", "TRAILING",
    "TRANSACTION", "TRIGGER", "TRUE", "TRUNCATE", "UNION", "UNIQUE", "UNSIGNED", "UPDATE", "USAGE", "USE",
    "USING", "VALUE", "VALUES", "VARBINARY", "VARCHAR", "VIEW", "WHEN", "WHERE", "WINDOW", "WITH", "ZEROFILL",
]

/** Table names that appear after FROM, JOIN, UPDATE or INTO. */
export const referencedTables = (sql: string): string[] => {
    const names = new Set<string>()
    const pattern = /\b(?:from|join|update|into)\s+`?([A-Za-z0-9_$]+)`?/gi
    for (let match = pattern.exec(sql); match !== null; match = pattern.exec(sql)) {
        names.add(match[1]!)
    }
    return [...names]
}

/**
 * Columns first, then tables, then keywords. Columns come from the tables the statement already
 * mentions, mirroring what the removed Rust analyzer used to offer. `prefix` filters case-insensitively.
 */
export const suggest = (opts: {
    sql: string
    prefix: string
    tables: ReadonlyMap<string, readonly string[]>
    keywords?: readonly string[]
    limit?: number
}): Suggestion[] => {
    const prefix = opts.prefix.toLowerCase()
    const accepts = (label: string) => label.toLowerCase().startsWith(prefix)
    const limit = opts.limit ?? 200
    const suggestions: Suggestion[] = []

    const seenColumns = new Set<string>()
    for (const table of referencedTables(opts.sql)) {
        for (const column of opts.tables.get(table) ?? []) {
            if (!accepts(column) || seenColumns.has(column)) { continue }
            seenColumns.add(column)
            suggestions.push({ label: column, kind: "column", detail: table })
        }
    }
    for (const table of [...opts.tables.keys()].sort()) {
        if (accepts(table)) { suggestions.push({ label: table, kind: "table" }) }
    }
    for (const keyword of opts.keywords ?? MYSQL_KEYWORDS) {
        if (accepts(keyword)) { suggestions.push({ label: keyword, kind: "keyword" }) }
    }
    return suggestions.slice(0, limit)
}
