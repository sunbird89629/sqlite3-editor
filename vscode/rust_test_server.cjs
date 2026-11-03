// Test-only HTTP transport for exercising the webview through the real Rust adapter.
const Module = require('module')
const load = Module._load
Module._load = function (name, ...args) { return name === 'vscode' ? { window: { showErrorMessage: console.error } } : load.call(this, name, ...args) }
const { LocalPythonClient } = require('./extension.js')
Module._load = load
const express = require('express')
const cors = require('cors')
const { Packr, Unpackr } = require('msgpackr')
const fs = require('fs')
const os = require('os')
const path = require('path')
const packr = new Packr({ useRecords: false, preserveNumericTypes: true })
const unpackr = new Unpackr({ largeBigIntToFloat: false, int64AsNumber: false, mapsAsObjects: true, useRecords: true, preserveNumericTypes: true })
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-editor-ui-rust-'))
process.on('exit', () => { fs.rmSync(temp, { recursive: true, force: true }) })
const db = path.join(temp, 'test.db')
fs.writeFileSync(db, '')
const bin = path.join(__dirname, 'bin', `sqlite3-editor-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`)
const client = new LocalPythonClient('', '', db, bin)
const state = {}
const server = express().use(express.raw()).use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }))
    .post('/query', (req, res) => client.request(req.body, (data) => res.send(data), (err) => res.status(400).send(err.message)))
    .post('/downloadState', (_, res) => res.send(packr.pack(state)))
    .post('/setState', (req, res) => { const { key, value } = unpackr.unpack(req.body); state[key] = value; res.send(packr.pack(null)) })
    .listen(8080, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) { process.on(signal, () => { client.close(); server.close() }) }
