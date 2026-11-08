import { Packr, Unpackr } from 'msgpackr'

const packr = new Packr({ useRecords: false, preserveNumericTypes: true })

export const encodeMessage = (value: unknown) => new Uint8Array(packr.pack(value))
export const decodeMessage = (value: Uint8Array) => new Unpackr({ mapsAsObjects: true }).unpack(value)
