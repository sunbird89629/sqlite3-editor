import { Unpackr } from 'msgpackr'

export const decodeMessage = (value: Uint8Array) => new Unpackr({ mapsAsObjects: true }).unpack(value)
