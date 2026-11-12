import express from "express"
import { createConnection } from "mysql2/promise"
import type { Connection } from "mysql2/promise"
import { Packr, Unpackr } from "msgpackr"
import { assertReadOnly } from "../vscode/mysql-guard"

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

/**
 * Development mirror of the extension host. It serves the same `/query` contract so that the
 * webview and the Playwright suite can run without VS Code.
 */
type QueryRequest = { query: string, params: unknown[], mode: "r" }

const parseMysqlUrl = (url: string) => {
    const parsed = new URL(url)
    return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    }
}

class MySqlServer {
    readonly #conn: Connection
    /** Test-only escape hatch: the Playwright suite seeds its fixtures through it. */
    readonly allowWrites: boolean
    #queue: Promise<unknown> = Promise.resolve()

    constructor(conn: Connection, allowWrites: boolean) {
        this.#conn = conn
        this.allowWrites = allowWrites
    }

    #serialize<T>(task: () => Promise<T>): Promise<T> {
        const run = this.#queue.then(task, task)
        this.#queue = run.catch(() => undefined)
        return run
    }

    query(sql: string, params: unknown[]) {
        return this.#serialize(async () => {
            const [rows, fields] = await this.#conn.query(sql, params)
            if (!Array.isArray(rows) || !fields) { return {} }
            return { columns: fields.map((field) => field.name), records: rows }
        })
    }

    execute(sql: string, params: unknown[]) {
        return this.#serialize(() => this.#conn.query(sql, params))
    }

    async close() {
        await this.#conn.end()
    }
}

const { MYSQL_URL, MYSQL_ALLOW_WRITES } = process.env
if (!MYSQL_URL) {
    console.error("MYSQL_URL is required, for example mysql://user:password@127.0.0.1:3306/database")
    process.exit(1)
}

const state: Record<string, unknown> = {}
const config = parseMysqlUrl(MYSQL_URL)
const conn = await createConnection({
    ...config,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
}).catch((err: Error) => {
    console.error(`Could not connect to ${config.host}:${config.port}/${config.database}: ${err.message}`)
    process.exit(1)
})
const allowWrites = MYSQL_ALLOW_WRITES === "1"
// The suite seeds its fixtures through /test/execute, so only the read-only session enforces this.
if (!allowWrites) { await conn.query("SET SESSION TRANSACTION READ ONLY") }
const server = new MySqlServer(conn, allowWrites)

express()
    // The webview runs on the Vite origin during development, so the mirror needs CORS.
    .use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type")
        if (req.method === "OPTIONS") { res.sendStatus(204); return }
        next()
    })
    .use(express.raw({ limit: "64mb" }))
    .use("/", express.static("../ui/dist"))
    .post("/query", (req, res) => {
        let request: QueryRequest
        try {
            request = unpackr.unpack(req.body as Buffer) as QueryRequest
            if (typeof request?.query !== "string" || !Array.isArray(request.params)) { throw new Error("Invalid arguments") }
        } catch (err) {
            res.status(400).send((err as Error).message)
            return
        }
        if (request.mode !== "r") { res.status(400).send("Read-only session: writes are not supported."); return }
        try {
            assertReadOnly(request.query)
        } catch (err) {
            res.status(400).send((err as Error).message)
            return
        }
        server.query(request.query, request.params).then(
            (result) => { res.send(packr.pack("columns" in result ? result : undefined)) },
            (err: Error) => { res.status(400).send(err.message) },
        )
    })
    .post("/test/execute", (req, res) => {
        if (!server.allowWrites) { res.status(404).send("Not found"); return }
        const { query, params } = unpackr.unpack(req.body as Buffer) as { query: string, params?: unknown[] }
        server.execute(query, params ?? []).then(
            () => { res.send(packr.pack(null)) },
            (err: Error) => { res.status(400).send(err.message) },
        )
    })
    .post("/setState", (req, res) => {
        const { key, value } = unpackr.unpack(req.body as Buffer) as { key: string, value: unknown }
        state[key] = value
        res.send(packr.pack(null))
    })
    .post("/session", (req, res) => {
        // Mirrors the extension host, so the history records the same database name in development.
        res.send(packr.pack({ database: config.database }))
    })
    .post("/downloadState", (req, res) => {
        res.send(packr.pack(state))
    })
    .listen(8080, "127.0.0.1")

// https://gist.github.com/hyrious/30a878f6e6a057f09db87638567cb11a
let closed = false
const close = () => {
    if (closed) { return }
    closed = true
    void server.close()
}
process.stdin.resume()
process.on("beforeExit", close)
process.on("exit", close)
process.on("SIGTERM", () => { close(); process.exit(1) })
process.on("SIGINT", () => { close(); process.exit(1) })
