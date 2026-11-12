import mysql from "mysql2/promise"
import { Packr, Unpackr } from "msgpackr"
import { assertReadOnly } from "./mysql-guard"

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

export type MySqlConnectionConfig = {
    id: string
    name?: string
    host: string
    port?: number
    user?: string
    password?: string
    database: string
}

export type QueryResult = { columns?: string[], records?: Record<string, unknown>[] }

const DISPLAY_NAME = (config: MySqlConnectionConfig) => config.name || `${config.host}/${config.database}`

/**
 * A read-only MySQL session. Values cross the webview boundary as msgpack, so the client keeps
 * the same `request(body, resolve, reject, key)` shape the file-based backend used to expose.
 */
type Queryable = {
    query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>
    end: () => Promise<void>
}

const CONNECTION_LOST_CODES = new Set([
    "PROTOCOL_CONNECTION_LOST",
    "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
    "ER_SERVER_SHUTDOWN",
    "ER_CONNECTION_KILLED",
])

const isConnectionLost = (err: unknown): boolean => {
    if (typeof err !== "object" || err === null) { return false }
    const { code, fatal, message } = err as { code?: unknown, fatal?: unknown, message?: unknown }
    if (typeof code === "string" && CONNECTION_LOST_CODES.has(code)) { return true }
    // The driver marks unrecoverable connection errors as fatal, sometimes without a code.
    if (fatal === true) { return true }
    return typeof message === "string" && /connection (is )?(lost|closed)|closed state|server has gone away/i.test(message)
}

const optionsFor = (config: MySqlConnectionConfig) => ({
    host: config.host,
    port: config.port ?? 3306,
    user: config.user || undefined,
    password: config.password || undefined,
    database: config.database,
    // Big numbers, decimals and dates arrive as strings: the webview grid can show them
    // without losing precision, and the msgpack payload stays simple.
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
    connectTimeout: 10_000,
})

export class MySqlClient {
    #conn: Queryable
    readonly label: string
    readonly #config: MySqlConnectionConfig | undefined
    #closed = false
    #queue: { run: () => void, key?: string, reject?: (err: Error) => void }[] = []

    private constructor(conn: Queryable, label: string, config?: MySqlConnectionConfig) {
        this.#conn = conn
        this.label = label
        this.#config = config
    }

    /** Builds a client around an existing connection. Used by tests; `connect()` is the normal path. */
    static forConnection(conn: Queryable, label = "test"): MySqlClient {
        return new MySqlClient(conn, label)
    }

    static async connect(config: MySqlConnectionConfig): Promise<MySqlClient> {
        const conn = await mysql.createConnection(optionsFor(config))
        try {
            await conn.query("SET SESSION TRANSACTION READ ONLY")
        } catch (err) {
            await conn.end().catch(() => undefined)
            throw err
        }
        return new MySqlClient(conn, DISPLAY_NAME(config), config)
    }

    /** Reopens the connection after the server closed it, so the next request recovers. */
    async #reconnect(): Promise<void> {
        if (!this.#config) { throw new Error("The connection was lost; reopen the session.") }
        const conn = await mysql.createConnection(optionsFor(this.#config))
        await conn.query("SET SESSION TRANSACTION READ ONLY").catch(() => undefined)
        const previous = this.#conn
        this.#conn = conn as unknown as Queryable
        await previous.end().catch(() => undefined)
    }

    async query(sql: string, params: unknown[]): Promise<QueryResult> {
        assertReadOnly(sql)
        let rows: unknown
        let fields: unknown
        try {
            [rows, fields] = await this.#conn.query(sql, params)
        } catch (err) {
            if (!isConnectionLost(err)) { throw err }
            await this.#reconnect()
            throw new Error(`The connection was lost (${(err as Error).message}). The next request reconnects.`)
        }
        if (!Array.isArray(rows) || !Array.isArray(fields)) { return {} }
        const columns = (fields as { name: string }[]).map((field) => field.name)
        return { columns, records: rows as Record<string, unknown>[] }
    }

    /** Entry point used by the webview op switch. Body is msgpack `{ query, params, mode }`. */
    request(body: Buffer | Uint8Array, resolve: (data: Buffer) => void, reject: (err: Error) => void, key?: string): void {
        if (this.#closed) { reject(new Error("Database connection closed")); return }
        let request: { query?: unknown, params?: unknown, mode?: unknown }
        try {
            request = unpackr.unpack(typeof body === "string" ? Buffer.from(body) : body as Buffer) as typeof request
        } catch (err) {
            reject(new Error(`Invalid request: ${(err as Error).message}`))
            return
        }
        const { query, params, mode } = request
        if (typeof query !== "string" || !Array.isArray(params)) { reject(new Error("Invalid arguments")); return }
        if (mode !== "r") { reject(new Error("Read-only session: writes are not supported.")); return }
        // Coalesce consecutive queued reads with the same key: superseded page requests are dropped.
        if (key) {
            for (let i = this.#queue.length - 1; i >= 1; i--) {
                const queued = this.#queue[i]!
                if (!queued.key) { break }
                if (queued.key === key) {
                    this.#queue.splice(i, 1)
                    queued.reject?.(new Error("Request superseded"))
                }
            }
        }
        const run = () => {
            this.query(query, params).then((result) => {
                resolve(packr.pack(result.columns ? result : undefined))
            }, (err: Error) => {
                reject(err)
            }).finally(() => {
                this.#queue.shift()
                this.#queue[0]?.run()
            })
        }
        this.#queue.push({ run, key, reject })
        if (this.#queue.length === 1) { run() }
    }

    async close(): Promise<void> {
        this.#closed = true
        this.#queue = []
        try {
            await this.#conn.end()
        } catch (err) {
            console.error("Closing the MySQL connection failed", err)
        }
    }
}
