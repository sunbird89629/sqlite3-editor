/**
 * Parameter values for statements in the native SQL editor.
 *
 * A statement takes its values from a `-- params:` comment line above it:
 *
 *     -- params: cid = 'abc', session = 42
 *     SELECT * FROM runs WHERE cid = :cid OR session = :session
 *
 * Only `name = literal` entries are accepted. Named placeholders may omit the
 * leading `:`, `$` or `@`; anonymous `?` and `?NNN` use SQLite's parameter index
 * (`?1`, `?2`, ...). Integers become BigInt because msgpackr copies `Number` as
 * float64, which SQLite reports as REAL (see insert-draft.ts for the same rule).
 */

// The Rust payload is unpacked with int64AsNumber: false, so positions arrive as BigInt.
export type ZeroIndexedLocation = { line: number | bigint, column: number | bigint }
export type ZeroIndexedRange = { start: ZeroIndexedLocation, end: ZeroIndexedLocation }

/** Shape returned by the Rust `code_lens` command (see list_placeholders.rs). */
export type Placeholder = { name: string | null, ranges_relative_to_stmt: ZeroIndexedRange[] }

/** One SQLite parameter after duplicate named placeholders are merged. */
export type Merged = { label: string, key: string, ranges: ZeroIndexedRange[] }

/** One parameter together with the value declared for it, if any. */
export type Validated = Merged & { value: unknown, missing: boolean }

export type Validation = { params: Validated[], errors: string[] }
export type Binding = { params: unknown[] } | { error: string }
export type Diagnostic = { range: ZeroIndexedRange, message: string, severity: "info" | "warning" }

const PARAMS_LINE = /^--\s*params\s*:(.*)$/i
const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

/** `:cid`, `$cid` and `@cid` all address the same parameter; `?1` keeps its index. */
const normalize = (label: string): string | null => {
    const name = label.trim().replace(/^[:@$]/, "")
    if (/^\?\d+$/.test(name)) { return name }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { return name }
    return null
}

/**
 * Merges placeholders so that every entry matches one SQLite parameter index.
 * The Rust backend lists a repeated named placeholder once per occurrence, while
 * SQLite binds all occurrences to a single index.
 */
export function mergePlaceholders(placeholders: Placeholder[]): Merged[] {
    const merged: Merged[] = []
    const seen = new Map<string, Merged>()
    for (const placeholder of placeholders) {
        if (placeholder.name === null) {
            const label = `?${merged.length + 1}`
            merged.push({ label, key: label, ranges: placeholder.ranges_relative_to_stmt })
            continue
        }
        const key = normalize(placeholder.name) ?? placeholder.name
        const existing = seen.get(key)
        if (existing) { existing.ranges.push(...placeholder.ranges_relative_to_stmt); continue }
        const entry: Merged = { label: placeholder.name, key, ranges: [...placeholder.ranges_relative_to_stmt] }
        seen.set(key, entry)
        merged.push(entry)
    }
    return merged
}

/**
 * Finds the `-- params:` line that applies to a statement.
 * Ordinary statements use the comment block directly above them, so a blank line
 * or another `--` comment is skipped and the first line of code ends the block.
 * A CTE entry point points inside its statement, so it uses the nearest earlier
 * definition instead.
 */
export function findParamsBlock(lines: string[], startLine: number, cte: boolean): string | null {
    if (cte) {
        for (let i = Math.min(startLine, lines.length - 1); i >= 0; i--) {
            const match = PARAMS_LINE.exec((lines[i] ?? "").trim())
            if (match) { return match[1] ?? "" }
        }
        return null
    }
    for (let i = startLine - 1; i >= 0; i--) {
        const line = (lines[i] ?? "").trim()
        if (line === "") { continue }
        if (!line.startsWith("--")) { return null }
        const match = PARAMS_LINE.exec(line)
        if (match) { return match[1] ?? "" }
    }
    return null
}

/** Splits on commas that are outside single-quoted strings. */
const splitTopLevel = (text: string): string[] => {
    const parts: string[] = []
    let current = ""
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const character = text[i]!
        if (quoted) {
            current += character
            if (character === "'") {
                if (text[i + 1] === "'") { current += "'"; i++ } else { quoted = false }
            }
            continue
        }
        if (character === "'") { quoted = true; current += character; continue }
        if (character === ",") { parts.push(current); current = ""; continue }
        current += character
    }
    parts.push(current)
    return parts.map((part) => part.trim()).filter((part) => part !== "")
}

/** Parses one SQL literal into the value that is bound to SQLite. */
export function parseLiteral(text: string): { value: unknown } | { error: "invalid" | "overflow" } {
    const trimmed = text.trim()
    if (/^null$/i.test(trimmed)) { return { value: null } }
    const blob = /^[xX]'([0-9a-fA-F]*)'$/.exec(trimmed)
    if (blob) {
        const hex = blob[1] ?? ""
        if (hex.length % 2 !== 0) { return { error: "invalid" } }
        return { value: new Uint8Array(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []) }
    }
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return { value: trimmed.slice(1, -1).replace(/''/g, "'") }
    }
    if (/^[+-]?\d+$/.test(trimmed)) {
        const value = BigInt(trimmed)
        if (value < INT64_MIN || value > INT64_MAX) { return { error: "overflow" } }
        return { value }
    }
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
        const value = Number(trimmed)
        return Number.isFinite(value) ? { value } : { error: "invalid" }
    }
    return { error: "invalid" }
}

export type Entry = { label: string, key: string, value: unknown }

/** Parses the text after `-- params:` into entries, in written order. */
export function parseEntries(text: string): { entries: Entry[] } | { error: string } {
    const entries: Entry[] = []
    for (const [index, part] of splitTopLevel(text).entries()) {
        const separator = part.indexOf("=")
        if (separator < 0) { return { error: `-- params: 第 ${index + 1} 项 ${part} 缺少 =；请写成 name = 值` } }
        const label = part.slice(0, separator).trim()
        const raw = part.slice(separator + 1).trim()
        const key = normalize(label)
        if (key === null) { return { error: `-- params: 第 ${index + 1} 项的参数名 ${label} 不合法` } }
        const literal = parseLiteral(raw)
        if ("error" in literal) {
            return { error: literal.error === "overflow"
                ? `-- params: ${label} = ${raw} 超出 64 位整数范围`
                : `-- params: 第 ${index + 1} 项 ${label} = ${raw} 不是合法字面量；字符串请加单引号，如 'abc'` }
        }
        entries.push({ label, key, value: literal.value })
    }
    return { entries }
}

/** Reports every parameter with its declared value and every problem found. */
export function validate(block: string | null, placeholders: Placeholder[]): Validation {
    const merged = mergePlaceholders(placeholders)
    const params: Validated[] = merged.map((entry) => ({ ...entry, value: undefined, missing: true }))
    if (merged.length === 0) { return { params, errors: [] } }
    if (block === null) {
        const hint = merged.map((entry) => `${entry.key} = …`).join(", ")
        return { params, errors: [`这条语句有 ${merged.length} 个参数（${merged.map((entry) => entry.label).join(", ")}），请在语句上方加一行 -- params: ${hint}`] }
    }
    const parsed = parseEntries(block)
    if ("error" in parsed) { return { params, errors: [parsed.error] } }
    const errors: string[] = []
    const byKey = new Map<string, Validated>()
    for (const param of params) { byKey.set(param.key, param) }
    const seen = new Set<string>()
    for (const entry of parsed.entries) {
        const target = byKey.get(entry.key)
        if (target === undefined) {
            errors.push(`-- params: 里的 ${entry.label} 不是这条语句的参数（可用：${merged.map((param) => param.label).join(", ")}）`)
            continue
        }
        if (seen.has(entry.key)) { errors.push(`-- params: 参数 ${target.label} 被定义了两次`); continue }
        seen.add(entry.key)
        target.value = entry.value
        target.missing = false
    }
    for (const param of params) { if (param.missing) { errors.push(`-- params: 缺少参数 ${param.label} 的值`) } }
    return { params, errors }
}

/** Values in SQLite parameter order, or the first problem found. */
export function bindParams(block: string | null, placeholders: Placeholder[]): Binding {
    const { params, errors } = validate(block, placeholders)
    const error = errors[0]
    if (error !== undefined) { return { error } }
    return { params: params.map((param) => param.value) }
}

const formatValue = (value: unknown): string => {
    if (value === null) { return "NULL" }
    if (typeof value === "bigint") { return value.toString() }
    if (typeof value === "number") { return String(value) }
    if (typeof value === "string") { return `'${value.replace(/'/g, "''")}'` }
    if (value instanceof Uint8Array) { return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}'` }
    return String(value)
}

/** Diagnostics shown on each placeholder, so values are visible while editing. */
export function paramDiagnostics(block: string | null, placeholders: Placeholder[]): Diagnostic[] {
    const { params, errors } = validate(block, placeholders)
    const diagnostics: Diagnostic[] = []
    for (const [index, param] of params.entries()) {
        const message = param.missing
            ? `参数 ${index + 1}（${param.label}）未在 -- params: 中定义`
            : `参数 ${index + 1}（${param.label}）= ${formatValue(param.value)}`
        for (const range of param.ranges) { diagnostics.push({ range, message, severity: param.missing ? "warning" : "info" }) }
    }
    const first = params[0]?.ranges[0]
    if (first) {
        for (const error of errors) {
            if (error.startsWith("-- params: 缺少参数")) { continue }
            diagnostics.push({ range: first, message: error, severity: "warning" })
        }
    }
    return diagnostics
}
