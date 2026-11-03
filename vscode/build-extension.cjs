const esbuild = require('esbuild')
const fs = require('fs/promises')
const path = require('path')

// The bundled msgpackr fork passes 0xffffffff to Buffer.utf8Write. Newer
// Node versions reject lengths beyond the remaining buffer capacity.
let patches = 0
esbuild.build({
    entryPoints: [path.join(__dirname, 'extension.ts')],
    bundle: true,
    outfile: path.join(__dirname, 'extension.js'),
    target: 'esnext',
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    minify: process.argv.includes('--minify'),
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
}).then(() => {
    if (!patches) { throw new Error('msgpackr compatibility patch did not match; inspect the installed dependency') }
    console.log(`Applied ${patches} msgpackr compatibility patch(es).`)
}).catch((err) => { console.error(err); process.exitCode = 1 })
