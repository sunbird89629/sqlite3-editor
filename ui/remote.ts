import { Packr, Unpackr } from "msgpackr"
import { useTableStore } from "./table"

export type MySqlValue = string | number | bigint | Uint8Array | null

export type Message = { data: { /* preact debugger also uses message events */ type: "sqlite3-editor-server" } & ({ requestId: undefined } | { requestId: number } & ({ err: string } | { body: Uint8Array })) }

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

const vscode = window.acquireVsCodeApi?.()
export const isVSCode = vscode !== undefined
/** The database this session is connected to; recorded with every history entry. */
export const session = () => post("/session", {}) as Promise<{ database: string } | undefined>
export const openNativeQuery = (tableName: string | undefined, prefill?: string) => post("/openNativeQuery", { tableName, prefill })
/** Opens a read-only snapshot of one row in the VS Code editor. */
export const openRowInEditor = (content: string, table: string | undefined, row: string) => post("/openRowInEditor", { content, column: "record", table, row })
/** Opens a read-only snapshot of one cell value in the VS Code editor. */
export const openCellInEditor = (content: string, column: string, table: string | undefined, row: string) => post("/openCellInEditor", { content, column, table, row })

const queue: { start: number }[] = []

const loop = () => {
    if (queue.length > 0 && Date.now() - queue[0]!.start > 1000) {
        document.body.classList.add("querying")
    } else {
        document.body.classList.remove("querying")
    }
    requestAnimationFrame(loop)
}
loop()

export type PostOptions = { withoutLogging?: boolean, coalesceKey?: string }

/** Send the data to the server with fetch(), or to the extension host with vscode.postMessage(). */
export const post = async (url: string, body: unknown, opts: PostOptions = {}) => {
    const id = { start: Date.now() }
    queue.push(id)
    if (vscode !== undefined) {
        return new Promise<unknown>((resolve, reject) => {
            const requestId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
            const timeout = window.setTimeout(() => {
                window.removeEventListener("message", callback)
                const message = "Request timed out; the result was not read."
                if (!opts.withoutLogging) { useTableStore.getState().addErrorMessage(message) }
                reject(new Error(message))
            }, 120000)
            const callback = ({ data }: Message) => {
                if (data.type !== "sqlite3-editor-server" || data.requestId !== requestId) { return }
                window.clearTimeout(timeout)
                window.removeEventListener("message", callback)
                if ("err" in data) {
                    if (!opts.withoutLogging) { useTableStore.getState().addErrorMessage(data.err) }
                    reject(new Error(data.err))
                    return
                }
                resolve(unpackr.unpack(data.body))
            }
            window.addEventListener("message", callback)
            vscode.postMessage({ requestId, path: url, body: packr.pack(body), coalesceKey: opts.coalesceKey })
        }).finally(() => {
            queue.splice(queue.indexOf(id)!, 1)
        })
    } else {
        try {
            let res: Response
            try {
                res = await fetch("http://localhost:8080" + url, { method: "POST", body: packr.pack(body), headers: { "Content-Type": "application/octet-stream" } })
            } catch (err) {
                if (!opts.withoutLogging) { useTableStore.getState().addErrorMessage(typeof err === "object" && err !== null && "message" in err ? err.message + "" : err + "") }
                throw err
            }
            if (!res.ok) {
                const message = await res.text()
                if (!opts.withoutLogging) { useTableStore.getState().addErrorMessage(message) }
                throw new Error(message)
            }
            return unpackr.unpack(new Uint8Array(await res.arrayBuffer()))
        } finally {
            queue.splice(queue.indexOf(id)!, 1)
        }
    }
}

/** A local copy of the persisted data in the server. */
let state: Record<string, unknown> = {}

/** Retrieves and stores the persisted data in the server. */
export const downloadState = (opts: PostOptions = {}): Promise<void> => post("/downloadState", {}, opts).then((value) => { state = value })

/** Stores the value with the given key to the server. */
export const setState = async <T>(key: string, value: T, opts: PostOptions = {} = {}) => {
    state[key] = value
    await post("/setState", { key, value }, opts)
}

/** Returns the value associated with the given key from local copy of the persisted data in the server. `downloadState()` have be called beforehand. */
export const getState = <T>(key: string): T | undefined => {
    return state[key] as T | undefined
}

export type QueryResult = { columns: string[], records: Record<string, MySqlValue>[] }

/** Runs a read-only statement through the session. */
export const query = (query: string, params: readonly MySqlValue[] = [], opts: PostOptions = {}): Promise<QueryResult | undefined> =>
    post(`/query`, { query, params, mode: "r" }, opts) as Promise<QueryResult | undefined>

export const openQueryFile = async (): Promise<{ name: string, content: string } | null> => {
    if (vscode) { return post("/openQueryFile", {}) as Promise<{ name: string, content: string } | null> }
    return new Promise((resolve) => {
        const input = document.createElement("input")
        input.type = "file"; input.accept = ".sql,text/plain"
        input.onchange = async () => { const file = input.files?.[0]; resolve(file ? { name: file.name, content: await file.text() } : null) }
        input.oncancel = () => resolve(null)
        input.click()
    })
}
export const saveQueryFile = async (content: string): Promise<string | null> => {
    if (vscode) { return post("/saveQueryFile", { content }) as Promise<string | null> }
    const url = URL.createObjectURL(new Blob([content], { type: "text/sql" }))
    const link = document.createElement("a"); link.href = url; link.download = "query.sql"; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return "query.sql"
}
