import esbuild from 'esbuild'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// The bundled msgpackr fork passes 0xffffffff to Buffer.utf8Write. Newer Node versions reject
// lengths beyond the remaining buffer capacity, so the same patch the extension build applies is
// needed here too.
const root = path.dirname(fileURLToPath(import.meta.url))
let patches = 0

await esbuild.build({
    entryPoints: [path.join(root, 'server.ts')],
    outfile: path.join(root, 'server.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    // msgpackr is bundled so the compatibility patch below applies to it.
    external: ['express', 'mysql2'],
    plugins: [{
        name: 'msgpackr-node-buffer-compat',
        setup(build) {
            build.onLoad({ filter: /[/\\]msgpackr[/\\](pack|struct)\.js$/ }, async ({ path: filepath }) => {
                let source = await fs.readFile(filepath, 'utf8')
                source = source.replace(/target\.utf8Write\((string|value),\s*position,\s*0xffffffff\)/g, (_, value) => {
                    patches++
                    return `target.utf8Write(${value}, position, target.length - position)`
                })
                return { contents: source, loader: 'js', resolveDir: path.dirname(filepath) }
            })
        },
    }],
})

if (!patches) { throw new Error('msgpackr compatibility patch did not match; inspect the installed dependency') }
console.log(`node-http: applied ${patches} msgpackr compatibility patch(es)`)
