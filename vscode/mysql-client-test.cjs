// Run with `npm test` in vscode/: bundles mysql-client.ts and drives it with a stub connection.
const assert = require('assert')
const { Packr, Unpackr } = require('msgpackr')
const { MySqlClient } = require('./.tmp/mysql-client.cjs')

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })

const stub = (rows, fields) => {
    const calls = []
    const connection = {
        query: async (sql, params) => { calls.push({ sql, params }); return [rows, fields] },
        end: async () => { calls.push({ sql: "<end>" }) },
    }
    return { connection, calls }
}

const request = (client, body, key) => new Promise((resolve, reject) => {
    client.request(packr.pack(body), (data) => resolve(unpackr.unpack(data)), reject, key)
})

;(async () => {
    // A read returns the same `{ columns, records }` shape the webview expects.
    {
        const { connection, calls } = stub([{ id: 1n, name: "a" }], [{ name: "id" }, { name: "name" }])
        const client = MySqlClient.forConnection(connection)
        const result = await request(client, { query: "SELECT id, name FROM t", params: [], mode: "r" })
        assert.deepStrictEqual(result.columns, ["id", "name"])
        assert.deepStrictEqual(result.records, [{ id: 1n, name: "a" }])
        assert.deepStrictEqual(calls, [{ sql: "SELECT id, name FROM t", params: [] }])
    }

    // Writes never reach the driver, whatever the request claims.
    {
        const { connection, calls } = stub([], undefined)
        const client = MySqlClient.forConnection(connection)
        await assert.rejects(() => request(client, { query: "DELETE FROM t", params: [], mode: "w+" }), /read-only/i)
        assert.deepStrictEqual(calls, [])
    }

    // The allow list runs before the driver too.
    {
        const { connection, calls } = stub([], undefined)
        const client = MySqlClient.forConnection(connection)
        await assert.rejects(() => request(client, { query: "/*!50000 DELETE FROM t */", params: [], mode: "r" }), (err) => err.name === "ReadOnlyViolation")
        assert.deepStrictEqual(calls, [])
    }

    // A statement without rows resolves to `undefined`, like the file-backed backend did.
    {
        const { connection } = stub([], undefined)
        const client = MySqlClient.forConnection(connection)
        assert.strictEqual(await request(client, { query: "SELECT 1", params: [], mode: "r" }), undefined)
    }

    // A queued read with the same coalesce key is superseded by a newer one; the running read finishes.
    {
        const resolvers = []
        const connection = {
            query: (sql) => new Promise((resolve) => { resolvers.push({ sql, resolve }) }),
            end: async () => { },
        }
        const client = MySqlClient.forConnection(connection)
        const first = request(client, { query: "SELECT 1", params: [], mode: "r" }, "page")
        const second = request(client, { query: "SELECT 2", params: [], mode: "r" }, "page")
        const third = request(client, { query: "SELECT 3", params: [], mode: "r" }, "page")
        await assert.rejects(() => second, /superseded/)
        const running = resolvers.shift()
        running.resolve([[{ n: running.sql }], [{ name: "n" }]])
        assert.deepStrictEqual((await first).records, [{ n: "SELECT 1" }])
        // The next queued request starts in the microtask that follows the finished one.
        while (resolvers.length === 0) { await new Promise((resolve) => setTimeout(resolve, 0)) }
        const queued = resolvers.shift()
        queued.resolve([[{ n: queued.sql }], [{ name: "n" }]])
        assert.deepStrictEqual((await third).records, [{ n: "SELECT 3" }])
        await client.close()
    }

    // A connection-level failure is reported as a lost connection instead of a raw driver error.
    {
        const connection = {
            query: async () => { const err = new Error("Connection lost: the server closed the connection."); err.code = "PROTOCOL_CONNECTION_LOST"; throw err },
            end: async () => { },
        }
        const client = MySqlClient.forConnection(connection)
        await assert.rejects(() => request(client, { query: "SELECT 1", params: [], mode: "r" }), /connection was lost/i)
    }

    // Closing rejects later requests.
    {
        const { connection } = stub([], undefined)
        const client = MySqlClient.forConnection(connection)
        await client.close()
        await assert.rejects(() => request(client, { query: "SELECT 1", params: [], mode: "r" }), /closed/i)
    }

    console.log("mysql-client: all assertions passed")
})().catch((err) => { console.error(err); process.exit(1) })
