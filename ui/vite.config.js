import { defineConfig } from "vite"
import preact from "@preact/preset-vite"
import license from "rollup-plugin-license"
import path from "path"

export default defineConfig({
    resolve: { alias: { "node:buffer": "buffer" } },
    plugins: [
        preact(),

        // https://github.com/vitejs/vite/discussions/7722#discussioncomment-4007436
        license({
            thirdParty: {
                output: path.resolve(__dirname, "./dist/assets/vendor.LICENSE.txt"),
            },
        }),
    ],
    build: {
        target: "esnext",
        rollupOptions: {
            // Two entries: the database viewer and the SQL result panel.
            input: {
                main: path.resolve(__dirname, "index.html"),
                results: path.resolve(__dirname, "results.html"),
            },
        },
    },
    esbuild: {
        logOverride: { 'this-is-undefined-in-esm': 'silent' },

        // https://github.com/vitejs/vite/discussions/7722#discussioncomment-4007436
        banner: '/*! licenses: /assets/vendor.LICENSE.txt */',
        legalComments: 'none',
    },
})
