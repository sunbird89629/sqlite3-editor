/**
 * The MySQL session is read-only. This module decides whether a statement may reach the driver.
 *
 * The check is an allow list on the leading keyword of every statement, applied to SQL with
 * comments and string literals removed. MySQL executes the contents of `/*! ... *\/` versioned
 * comments, so those are expanded instead of removed.
 */

export class ReadOnlyViolation extends Error {
    constructor(statement: string) {
        super(`Read-only session: ${statement} is not allowed. Only SELECT, SHOW, DESCRIBE, EXPLAIN, TABLE and VALUES may run.`)
        this.name = "ReadOnlyViolation"
    }
}

const ALLOWED = new Set(["SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "TABLE", "VALUES", "WITH"])

/** Removes comments and replaces literal contents with spaces, keeping statement boundaries. */
export const stripCommentsAndLiterals = (sql: string): string => {
    let out = ""
    let i = 0
    while (i < sql.length) {
        const ch = sql[i]!
        const next = sql[i + 1]
        if (ch === "/" && next === "*") {
            // A versioned comment (`/*!50000 ... */`) is executable: keep its body.
            if (sql[i + 2] === "!") {
                const end = sql.indexOf("*/", i)
                const body = sql.slice(i + 3, end === -1 ? undefined : end).replace(/^\d{5,6}/, "")
                out += " " + stripCommentsAndLiterals(body) + " "
                i = end === -1 ? sql.length : end + 2
                continue
            }
            const end = sql.indexOf("*/", i + 2)
            i = end === -1 ? sql.length : end + 2
            out += " "
            continue
        }
        if ((ch === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]!))) || ch === "#") {
            const end = sql.indexOf("\n", i)
            i = end === -1 ? sql.length : end
            out += " "
            continue
        }
        if (ch === "'" || ch === '"' || ch === "`") {
            i++
            while (i < sql.length) {
                const c = sql[i]!
                if (c === "\\" && ch !== "`") { i += 2; continue }
                if (c === ch) {
                    if (sql[i + 1] === ch) { i += 2; continue }  // doubled quote
                    i++
                    break
                }
                i++
            }
            out += "''"
            continue
        }
        out += ch
        i++
    }
    return out
}

/** Splits on semicolons that are outside literals and comments. */
const splitStatements = (sql: string): string[] => stripCommentsAndLiterals(sql).split(";").map((s) => s.trim()).filter((s) => s !== "")

/** Throws `ReadOnlyViolation` unless every statement starts with an allowed keyword. */
export const assertReadOnly = (sql: string): void => {
    if (typeof sql !== "string" || sql.trim() === "") { throw new ReadOnlyViolation("(empty)") }
    for (const statement of splitStatements(sql)) {
        const keyword = /^[A-Za-z]+/.exec(statement)?.[0]?.toUpperCase()
        if (!keyword || !ALLOWED.has(keyword)) { throw new ReadOnlyViolation(keyword ?? statement.slice(0, 20)) }
        // A WITH clause may introduce a data-modifying statement in MySQL 8.0.
        if (keyword === "WITH" && /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(statement)) { throw new ReadOnlyViolation("WITH ... data modification") }
        if (keyword === "SELECT" && /\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(statement)) { throw new ReadOnlyViolation("SELECT ... INTO OUTFILE") }
    }
}
