/**
 * Named parameters for statements in the SQL editor.
 *
 *     -- params: run_id = 'run_9d18', limit = 10
 *     SELECT * FROM runs WHERE id = :run_id LIMIT :limit
 *
 * The `-- params:` comment directly above a statement declares values; every `:name` in the
 * statement (outside comments and literals) becomes a positional `?` for MySQL, bound in order.
 */

export type ParamValue = string | number | boolean | null
export type BindResult = {
    /** The statement that goes to the driver: placeholders become `?`. */
    sql: string
    params: ParamValue[]
    /** The same statement as a human reads it: comments removed, values inlined. */
    display: string
} | { error: string }

/** A value as a MySQL literal, so the executed statement can be shown and copied as plain SQL. */
export const literalOf = (value: ParamValue): string => {
    if (value === null) { return "NULL" }
    if (typeof value === "boolean") { return value ? "TRUE" : "FALSE" }
    if (typeof value === "number") { return String(value) }
    return `'${value
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "''")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("\t", "\\t")}'`
}

const PARAMS_LINE = /^--\s*params\s*:(.*)$/i
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The `-- params:` text for a statement that starts at `startLine`, or `null` when there is none. */
export const paramsBlockAt = (lines: readonly string[], startLine: number): string | null => {
    for (let index = startLine - 1; index >= 0; index -= 1) {
        const line = (lines[index] ?? "").trim()
        if (line === "") { continue }
        if (!line.startsWith("--")) { return null }
        const match = PARAMS_LINE.exec(line)
        if (match) { return (match[1] ?? "").trim() }
    }
    return null
}

/** Splits on commas that are not inside a quoted literal. */
const splitEntries = (text: string): string[] => {
    const entries: string[] = []
    let current = ""
    let quote: string | null = null
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!
        if (quote !== null) {
            current += character
            if (character === "\\") { current += text[index + 1] ?? ""; index += 1; continue }
            if (character === quote) { quote = null }
            continue
        }
        if (character === "'" || character === '"') { quote = character; current += character; continue }
        if (character === ",") { entries.push(current); current = ""; continue }
        current += character
    }
    if (current.trim() !== "") { entries.push(current) }
    return entries.map((entry) => entry.trim()).filter((entry) => entry !== "")
}

const unquote = (literal: string): string => {
    const quote = literal[0]!
    let value = ""
    for (let index = 1; index < literal.length - 1; index += 1) {
        const character = literal[index]!
        if (character === "\\") {
            const next = literal[index + 1] ?? ""
            value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next
            index += 1
            continue
        }
        if (character === quote && literal[index + 1] === quote) { value += quote; index += 1; continue }
        value += character
    }
    return value
}

const parseValue = (literal: string): ParamValue | undefined => {
    const text = literal.trim()
    if (text === "") { return undefined }
    if ((text.startsWith("'") && text.endsWith("'") && text.length >= 2) || (text.startsWith('"') && text.endsWith('"') && text.length >= 2)) {
        return unquote(text)
    }
    if (/^-?\d+$/.test(text)) { return Number(text) }
    if (/^-?\d*\.\d+(e[-+]?\d+)?$/i.test(text) || /^-?\d+e[-+]?\d+$/i.test(text)) { return Number(text) }
    if (/^null$/i.test(text)) { return null }
    if (/^true$/i.test(text)) { return true }
    if (/^false$/i.test(text)) { return false }
    return undefined
}

export type ParsedParams = { values: Map<string, ParamValue>, errors: string[] }

/** Reads `name = literal` entries; anything else is reported as an error instead of being ignored. */
export const parseParams = (block: string): ParsedParams => {
    const values = new Map<string, ParamValue>()
    const errors: string[] = []
    for (const entry of splitEntries(block)) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(entry)
        if (match === null) {
            errors.push(`Cannot read the parameter "${entry}". Use name = 'value'.`)
            continue
        }
        const value = parseValue(match[2]!)
        if (value === undefined) {
            errors.push(`Cannot read the value of "${match[1]}". Use a quoted string, a number, NULL, true or false.`)
            continue
        }
        values.set(match[1]!, value)
    }
    return { values, errors }
}

/** Placeholder names in the statement, in order, skipping comments and literals. */
export const placeholderNames = (sql: string): string[] => {
    const names: string[] = []
    let index = 0
    while (index < sql.length) {
        const character = sql[index]!
        const next = sql[index + 1]
        if (character === "-" && next === "-" || character === "#") {
            const end = sql.indexOf("\n", index)
            index = end === -1 ? sql.length : end
            continue
        }
        if (character === "/" && next === "*") {
            const end = sql.indexOf("*/", index + 2)
            index = end === -1 ? sql.length : end + 2
            continue
        }
        if (character === "'" || character === '"' || character === "`") {
            const quote = character
            index += 1
            while (index < sql.length) {
                const current = sql[index]!
                if (current === "\\" && quote !== "`") { index += 2; continue }
                if (current === quote) {
                    if (sql[index + 1] === quote) { index += 2; continue }
                    index += 1
                    break
                }
                index += 1
            }
            continue
        }
        if (character === ":") {
            let end = index + 1
            while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end]!)) { end += 1 }
            const name = sql.slice(index + 1, end)
            if (NAME.test(name)) { names.push(name); index = end; continue }
        }
        index += 1
    }
    return names
}

/**
 * Turns `:name` into `?` and returns the values in order. Every placeholder must have a value and
 * every declared value must be used, so a typo fails before the statement reaches the server.
 */
export const bindParams = (sql: string, values: Map<string, ParamValue>): BindResult => {
    const names = placeholderNames(sql)
    if (names.length === 0) {
        if (values.size === 0) { return { sql, params: [], display: stripComments(sql) } }
        return { error: `The statement uses no :name placeholder, but -- params: declares ${[...values.keys()].map((name) => `"${name}"`).join(", ")}.` }
    }
    const missing = [...new Set(names)].filter((name) => !values.has(name))
    if (missing.length > 0) {
        return { error: `Missing a value for ${missing.map((name) => `:${name}`).join(", ")}. Add it to the -- params: line.` }
    }
    const unused = [...values.keys()].filter((name) => !names.includes(name))
    if (unused.length > 0) {
        return { error: `-- params: declares ${unused.map((name) => `"${name}"`).join(", ")}, but the statement never uses it.` }
    }

    const params: ParamValue[] = []
    let bound = ""
    let display = ""
    let index = 0
    while (index < sql.length) {
        const character = sql[index]!
        const next = sql[index + 1]
        if (character === "-" && next === "-" || character === "#") {
            // The comment leaves the statement, the line break after it stays for readability.
            const end = sql.indexOf("\n", index)
            const stop = end === -1 ? sql.length : end
            bound += sql.slice(index, stop)
            index = stop
            continue
        }
        if (character === "/" && next === "*") {
            const end = sql.indexOf("*/", index + 2)
            const stop = end === -1 ? sql.length : end + 2
            const removed = sql.slice(index, stop)
            bound += removed
            display += (removed.match(/\n/g) ?? []).join("")
            index = stop
            continue
        }
        if (character === "'" || character === '"' || character === "`") {
            const quote = character
            const from = index
            index += 1
            while (index < sql.length) {
                const current = sql[index]!
                if (current === "\\" && quote !== "`") { index += 2; continue }
                if (current === quote) {
                    if (sql[index + 1] === quote) { index += 2; continue }
                    index += 1
                    break
                }
                index += 1
            }
            bound += sql.slice(from, index)
            display += sql.slice(from, index)
            continue
        }
        if (character === ":") {
            let end = index + 1
            while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end]!)) { end += 1 }
            const name = sql.slice(index + 1, end)
            if (NAME.test(name)) {
                const value = values.get(name)!
                params.push(value)
                bound += "?"
                display += literalOf(value)
                index = end
                continue
            }
        }
        bound += character
        display += character
        index += 1
    }
    return { sql: bound, params, display: tidy(display) }
}

/** Removes comments while keeping the line breaks they contained. */
export const stripComments = (sql: string): string => tidy(sql.replace(/--[^\n]*|#[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, (match) => (match.match(/\n/g) ?? []).join("")))

/**
 * Trims trailing whitespace, drops the blank lines that comment removal leaves behind and the
 * blank lines at the edges, so the displayed statement has no holes in it.
 */
const tidy = (sql: string): string => sql
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
