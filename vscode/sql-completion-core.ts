/** Pure helpers behind the SQL completion provider, kept free of the `vscode` API so they can be tested. */

export type SuggestionKind = "column" | "table" | "function" | "keyword"
export type Suggestion = { label: string, kind: SuggestionKind, detail?: string }

/** MySQL 8 keywords worth completing. The full reserved set is longer; this is the useful part. */
export const MYSQL_KEYWORDS: readonly string[] = [
    "ADD", "AFTER", "ALL", "ALTER", "ANALYZE", "AND", "AS", "ASC", "AUTO_INCREMENT", "BEFORE", "BEGIN",
    "BETWEEN", "BIGINT", "BINARY", "BLOB", "BOTH", "BY", "CASCADE", "CASE", "CHANGE", "CHAR", "CHARACTER",
    "CHARSET", "CHECK", "COLLATE", "COLUMN", "COLUMNS", "COMMENT", "CONSTRAINT", "CONTINUE", "CONVERT",
    "CREATE", "CROSS", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURRENT_USER", "CURSOR",
    "DATABASE", "DATABASES", "DATETIME", "DECIMAL", "DECLARE", "DEFAULT", "DELETE", "DESC", "DESCRIBE",
    "DISTINCT", "DISTINCTROW", "DIV", "DOUBLE", "DROP", "EACH", "ELSE", "ELSEIF", "END", "ENGINE", "ESCAPE",
    "EXISTS", "EXIT", "EXPLAIN", "FALSE", "FETCH", "FIELDS", "FLOAT", "FOR", "FORCE", "FOREIGN", "FROM",
    "FULLTEXT", "GENERATED", "GRANT", "GROUP", "GROUPING", "HAVING", "IF", "IGNORE", "IN", "INDEX", "INFILE",
    "INNER", "INOUT", "INSERT", "INT", "INTEGER", "INTERVAL", "INTO", "IS", "ITERATE", "JOIN", "JSON", "KEY",
    "KEYS", "KILL", "LATERAL", "LEADING", "LEAVE", "LEFT", "LIKE", "LIMIT", "LINES", "LOAD", "LOCK", "LONG",
    "LONGBLOB", "LONGTEXT", "LOOP", "MATCH", "MEDIUMBLOB", "MEDIUMINT", "MEDIUMTEXT", "MOD", "MODIFIES",
    "NATURAL", "NOT", "NULL", "NUMERIC", "OF", "ON", "OPTIMIZE", "OPTION", "OPTIONALLY", "OR", "ORDER", "OUT",
    "OUTER", "OUTFILE", "OVER", "PARTITION", "PRECISION", "PRIMARY", "PROCEDURE", "RANGE", "READ", "REAL",
    "RECURSIVE", "REFERENCES", "REGEXP", "RELEASE", "RENAME", "REPEAT", "REPLACE", "REQUIRE", "RESTRICT",
    "RETURN", "REVOKE", "RIGHT", "RLIKE", "ROLLUP", "ROW", "ROWS", "SCHEMA", "SCHEMAS", "SELECT", "SEPARATOR",
    "SET", "SHOW", "SIGNAL", "SMALLINT", "SPATIAL", "SQL", "SSL", "START", "STORED", "STRAIGHT_JOIN", "TABLE",
    "TABLES", "TEMPORARY", "TEXT", "THEN", "TINYBLOB", "TINYINT", "TINYTEXT", "TO", "TRAILING", "TRANSACTION",
    "TRIGGER", "TRUE", "TRUNCATE", "UNDO", "UNION", "UNIQUE", "UNSIGNED", "UPDATE", "USAGE", "USE", "USING",
    "VALUE", "VALUES", "VARBINARY", "VARCHAR", "VARYING", "VIEW", "VIRTUAL", "WHEN", "WHERE", "WHILE",
    "WINDOW", "WITH", "WRITE", "XOR", "ZEROFILL",
]

/** Builtin functions of MySQL 8. Functions are listed separately so they rank above plain keywords. */
export const MYSQL_FUNCTIONS: readonly string[] = [
    // JSON
    "JSON_ARRAY", "JSON_ARRAYAGG", "JSON_ARRAY_APPEND", "JSON_ARRAY_INSERT", "JSON_CONTAINS",
    "JSON_CONTAINS_PATH", "JSON_DEPTH", "JSON_EXTRACT", "JSON_INSERT", "JSON_KEYS", "JSON_LENGTH",
    "JSON_MERGE_PATCH", "JSON_MERGE_PRESERVE", "JSON_OBJECT", "JSON_OBJECTAGG", "JSON_OVERLAPS",
    "JSON_PRETTY", "JSON_QUOTE", "JSON_REMOVE", "JSON_REPLACE", "JSON_SCHEMA_VALID",
    "JSON_SCHEMA_VALIDATION_REPORT", "JSON_SEARCH", "JSON_SET", "JSON_STORAGE_FREE", "JSON_STORAGE_SIZE",
    "JSON_TABLE", "JSON_TYPE", "JSON_UNQUOTE", "JSON_VALID", "JSON_VALUE",
    // string
    "ASCII", "BIN", "BIT_LENGTH", "CHAR_LENGTH", "CHARACTER_LENGTH", "CONCAT", "CONCAT_WS", "ELT", "EXPORT_SET",
    "FIELD", "FIND_IN_SET", "FORMAT", "FROM_BASE64", "HEX", "INSERT", "INSTR", "LCASE", "LEFT", "LENGTH",
    "LOCATE", "LOWER", "LPAD", "LTRIM", "MAKE_SET", "MID", "OCT", "OCTET_LENGTH", "ORD", "QUOTE", "REGEXP_INSTR",
    "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "REPEAT", "REPLACE", "REVERSE", "RIGHT", "RPAD", "RTRIM",
    "SOUNDEX", "SPACE", "SUBSTR", "SUBSTRING", "SUBSTRING_INDEX", "TO_BASE64", "TRIM", "UCASE", "UNHEX", "UPPER",
    "WEIGHT_STRING",
    // numeric
    "ABS", "ACOS", "ASIN", "ATAN", "ATAN2", "CEIL", "CEILING", "CONV", "COS", "COT", "CRC32", "DEGREES", "EXP",
    "FLOOR", "GREATEST", "LEAST", "LN", "LOG", "LOG10", "LOG2", "MOD", "PI", "POW", "POWER", "RADIANS", "RAND",
    "ROUND", "SIGN", "SIN", "SQRT", "TAN", "TRUNCATE",
    // date and time
    "ADDDATE", "ADDTIME", "CONVERT_TZ", "CURDATE", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CURTIME",
    "DATE", "DATE_ADD", "DATE_FORMAT", "DATE_SUB", "DATEDIFF", "DAY", "DAYNAME", "DAYOFMONTH", "DAYOFWEEK",
    "DAYOFYEAR", "EXTRACT", "FROM_DAYS", "FROM_UNIXTIME", "HOUR", "LAST_DAY", "LOCALTIME", "LOCALTIMESTAMP",
    "MAKEDATE", "MAKETIME", "MICROSECOND", "MINUTE", "MONTH", "MONTHNAME", "NOW", "PERIOD_ADD", "PERIOD_DIFF",
    "QUARTER", "SEC_TO_TIME", "SECOND", "STR_TO_DATE", "SUBDATE", "SUBTIME", "SYSDATE", "TIME", "TIME_FORMAT",
    "TIME_TO_SEC", "TIMEDIFF", "TIMESTAMP", "TIMESTAMPADD", "TIMESTAMPDIFF", "TO_DAYS", "TO_SECONDS",
    "UNIX_TIMESTAMP", "UTC_DATE", "UTC_TIME", "UTC_TIMESTAMP", "WEEK", "WEEKDAY", "WEEKOFYEAR", "YEAR", "YEARWEEK",
    // aggregate and window
    "AVG", "BIT_AND", "BIT_OR", "BIT_XOR", "COUNT", "CUME_DIST", "DENSE_RANK", "FIRST_VALUE", "GROUP_CONCAT",
    "LAG", "LAST_VALUE", "LEAD", "MAX", "MIN", "NTH_VALUE", "NTILE", "PERCENT_RANK", "RANK", "ROW_NUMBER", "STD",
    "STDDEV", "STDDEV_POP", "STDDEV_SAMP", "SUM", "VAR_POP", "VAR_SAMP", "VARIANCE",
    // information and control
    "BENCHMARK", "BIT_COUNT", "CAST", "COALESCE", "CONNECTION_ID", "CONVERT", "DATABASE", "FOUND_ROWS", "IF",
    "IFNULL", "LAST_INSERT_ID", "NULLIF", "ROW_COUNT", "SESSION_USER", "SLEEP", "SYSTEM_USER", "USER", "UUID",
    "UUID_SHORT", "VERSION",
    // crypto
    "AES_DECRYPT", "AES_ENCRYPT", "COMPRESS", "MD5", "RANDOM_BYTES", "SHA1", "SHA2", "UNCOMPRESS",
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
 * Columns first, then tables, then functions, then keywords. Columns come from the tables the
 * statement already mentions. `prefix` filters case-insensitively.
 */
export const suggest = (opts: {
    sql: string
    prefix: string
    tables: ReadonlyMap<string, readonly string[]>
    keywords?: readonly string[]
    functions?: readonly string[]
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
    const functions = opts.functions ?? MYSQL_FUNCTIONS
    for (const fn of functions) {
        if (accepts(fn)) { suggestions.push({ label: fn, kind: "function" }) }
    }
    const suggested = new Set(suggestions.map((item) => item.label))
    for (const keyword of opts.keywords ?? MYSQL_KEYWORDS) {
        // A name that is both (e.g. `REPLACE`) is offered once, as the function.
        if (accepts(keyword) && !suggested.has(keyword)) { suggestions.push({ label: keyword, kind: "keyword" }) }
    }
    return suggestions.slice(0, limit)
}
