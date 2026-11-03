const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const backend = path.resolve(__dirname, '../rust-backend')
const built = spawnSync('cargo', ['build', '--release', '--locked'], { cwd: backend, stdio: 'inherit' })
if (built.error) { console.error(built.error.message); process.exit(1) }
if (built.status !== 0) { process.exit(built.status || 1) }
const suffix = process.platform === 'win32' ? '.exe' : ''
const destination = path.join(__dirname, 'bin')
fs.mkdirSync(destination, { recursive: true })
fs.copyFileSync(path.join(backend, 'target', 'release', 'sqlite3-editor' + suffix), path.join(destination, `sqlite3-editor-${process.platform}-${process.arch}${suffix}`))
fs.copyFileSync(path.join(backend, 'LICENSE'), path.join(destination, 'RUST-BACKEND-LICENSE.txt'))
if (process.platform !== 'win32') { fs.chmodSync(path.join(destination, `sqlite3-editor-${process.platform}-${process.arch}`), 0o755) }
