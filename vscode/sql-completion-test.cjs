// Run with `npm test` in vscode/: checks the pure completion helpers.
const assert = require('assert')
const { suggest, referencedTables, MYSQL_KEYWORDS, MYSQL_FUNCTIONS } = require('./.tmp/sql-completion-core.cjs')

const tables = new Map([
    ["orders", ["id", "created_at", "status", "customer_id"]],
    ["customers", ["id", "email", "name"]],
])

// Table references are read from the statements the user is writing.
assert.deepStrictEqual(referencedTables("SELECT * FROM orders"), ["orders"])
assert.deepStrictEqual(referencedTables("select * from `orders` o join customers c on o.customer_id = c.id"), ["orders", "customers"])
assert.deepStrictEqual(referencedTables("UPDATE orders SET status = 1"), ["orders"])
assert.deepStrictEqual(referencedTables("INSERT INTO customers VALUES (1)"), ["customers"])
assert.deepStrictEqual(referencedTables("SELECT 1"), [])

// Columns of the referenced tables come first, then tables, then keywords.
{
    const items = suggest({ sql: "SELECT * FROM orders WHERE ", prefix: "st", tables })
    // The column is offered first; keywords that share the prefix follow it.
    assert.deepStrictEqual(items[0], { label: "status", kind: "column", detail: "orders" })
    assert.ok(items.every((i) => i.kind !== "column" || i.label === "status"))
    assert.ok(items.some((i) => i.kind === "keyword" && i.label === "START"))
}
{
    const items = suggest({ sql: "SELECT * FROM orders o JOIN customers c ON o.id = c.id WHERE ", prefix: "c", tables })
    const kinds = items.map((i) => i.kind)
    const firstKeyword = kinds.indexOf("keyword")
    assert.ok(kinds.lastIndexOf("column") < firstKeyword, "columns precede keywords")
    assert.ok(kinds.lastIndexOf("table") < firstKeyword, "tables precede keywords")
    assert.ok(items.some((i) => i.label === "created_at" && i.detail === "orders"))
    assert.ok(items.some((i) => i.label === "customers" && i.kind === "table"))
}

// A prefix filters case-insensitively; an empty prefix lists everything, capped by the limit.
{
    assert.deepStrictEqual(suggest({ sql: "SELECT * FROM orders", prefix: "CREATED", tables }).map((i) => i.label), ["created_at"])
    const all = suggest({ sql: "SELECT 1", prefix: "", tables: new Map(), keywords: MYSQL_KEYWORDS, functions: [], limit: 5 })
    assert.strictEqual(all.length, 5)
    assert.ok(all.every((i) => i.kind === "keyword"))
}

// Without metadata the provider still has keywords to offer.
assert.ok(suggest({ sql: "SELECT * FROM unknown", prefix: "SEL", tables: new Map() }).some((i) => i.label === "SELECT" && i.kind === "keyword"))

// Builtin functions complete too, and rank above plain keywords.
{
    const items = suggest({ sql: "SELECT ", prefix: "json_unq", tables: new Map() })
    assert.deepStrictEqual(items.map((i) => [i.label, i.kind]), [["JSON_UNQUOTE", "function"]])
}
{
    const items = suggest({ sql: "SELECT ", prefix: "JSON_E", tables: new Map() })
    assert.ok(items.every((i) => i.kind === "function"))
    assert.ok(items.some((i) => i.label === "JSON_EXTRACT"))
}
{
    // A name that is both a function and a keyword is offered once, as the function.
    const items = suggest({ sql: "SELECT ", prefix: "REPLACE", tables: new Map() })
    assert.deepStrictEqual(items.filter((i) => i.label === "REPLACE").map((i) => i.kind), ["function"])
}
{
    // Columns still come first.
    const items = suggest({ sql: "SELECT * FROM orders WHERE ", prefix: "st", tables })
    assert.strictEqual(items[0].kind, "column")
    assert.ok(items.some((i) => i.kind === "function" && i.label === "STR_TO_DATE"))
}
assert.ok(MYSQL_FUNCTIONS.includes("JSON_UNQUOTE") && MYSQL_FUNCTIONS.includes("DATE_FORMAT"))
assert.strictEqual(new Set([...MYSQL_FUNCTIONS, ...MYSQL_KEYWORDS]).size, MYSQL_FUNCTIONS.length + MYSQL_KEYWORDS.length - new Set(MYSQL_FUNCTIONS.filter((name) => MYSQL_KEYWORDS.includes(name))).size)

console.log("sql-completion: all assertions passed")
