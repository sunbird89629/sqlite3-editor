/**
 * Splits a SQL document into statements with their starting line, so the editor can offer one
 * "Run" link per statement. Comments and literals are skipped, so a `;` inside them does not split.
 */

export type Statement = { sql: string, line: number }

export const splitStatements = (text: string): Statement[] => {
    const statements: Statement[] = []
    let start = 0
    let line = 0
    let startLine = 0
    let index = 0

    /** Skips leading whitespace and comments so the reported line is where the statement starts. */
    const firstContent = (from: number, to: number) => {
        let index = from
        while (index < to) {
            const character = text[index]!
            if (/\s/.test(character)) { index += 1; continue }
            if (character === "-" && text[index + 1] === "-" || character === "#") {
                const end = text.indexOf("\n", index)
                index = end === -1 || end > to ? to : end + 1
                continue
            }
            if (character === "/" && text[index + 1] === "*") {
                const end = text.indexOf("*/", index + 2)
                index = end === -1 ? to : end + 2
                continue
            }
            break
        }
        return index
    }
    const flush = (end: number) => {
        const content = firstContent(start, end)
        const sql = text.slice(content, end).trim()
        if (sql === "") { return }
        const line = startLine + (text.slice(start, content).match(/\n/g) ?? []).length
        statements.push({ sql, line })
    }

    while (index < text.length) {
        const character = text[index]!
        const next = text[index + 1]
        if (character === "\n") { line += 1; index += 1; continue }
        if (character === "-" && next === "-" || character === "#") {
            const end = text.indexOf("\n", index)
            index = end === -1 ? text.length : end
            continue
        }
        if (character === "/" && next === "*") {
            // A versioned comment (`/*!50000 ... */`) is executable, so it stays part of the statement.
            const end = text.indexOf("*/", index + 2)
            const stop = end === -1 ? text.length : end + 2
            line += (text.slice(index, stop).match(/\n/g) ?? []).length
            index = stop
            continue
        }
        if (character === "'" || character === '"' || character === "`") {
            const quote = character
            index += 1
            while (index < text.length) {
                const current = text[index]!
                if (current === "\\" && quote !== "`") { index += 2; continue }
                if (current === "\n") { line += 1; index += 1; continue }
                if (current === quote) {
                    if (text[index + 1] === quote) { index += 2; continue }
                    index += 1
                    break
                }
                index += 1
            }
            continue
        }
        if (character === ";") {
            flush(index)
            index += 1
            // Everything up to the first non-space on the next line starts the next statement.
            while (index < text.length && /\s/.test(text[index]!)) {
                if (text[index] === "\n") { line += 1 }
                index += 1
            }
            start = index
            startLine = line
            continue
        }
        index += 1
    }
    flush(text.length)
    return statements
}
