/** Database identity and column definitions are captured when a draft is opened. */
export type InsertFieldType = 'default' | 'null' | 'string' | 'number' | 'blob'
export type InsertField = { name: string, type: InsertFieldType, value: string, blob: number[] | null }
export type InsertDraft = { database: string, table: string, fields: InsertField[] }
export type InsertParameter = string | number | bigint | Uint8Array | null

const identifier = (value: string) => `"${value.replace(/"/g, '""')}"`

/** Convert a draft to a parameterized SQLite INSERT. Values never enter SQL text. */
export function buildInsert(draft: InsertDraft): { query: string, params: InsertParameter[] } {
    const fields = draft.fields.filter((field) => field.type !== 'default')
    if (!fields.length) { return { query: `INSERT INTO ${identifier(draft.table)} DEFAULT VALUES`, params: [] } }
    const params = fields.map((field): InsertParameter => {
        switch (field.type) {
            case 'null': return null
            case 'string': return field.value
            case 'blob': return new Uint8Array(field.blob ?? [])
            case 'number': {
                const value = field.value.trim()
                if (!value) { return 0n }
                if (/^[+-]?\d+$/.test(value)) {
                    const integer = BigInt(value)
                    if (integer >= -(2n ** 63n) && integer <= 2n ** 63n - 1n) { return integer }
                }
                const number = Number(value)
                if (!Number.isFinite(number)) { throw new Error(`Invalid numeric value for ${field.name}`) }
                return number
            }
            default: throw new Error('Unexpected default field')
        }
    })
    return { query: `INSERT INTO ${identifier(draft.table)} (${fields.map((field) => identifier(field.name)).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, params }
}
