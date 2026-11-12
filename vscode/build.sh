#!/bin/sh
set -e

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# Build ../ui/ and copy the bundle ./webview
cd "$script_dir" || exit 1
rm -rf ./webview
cd ../ui || exit 1
npm run _build
cd "$script_dir" || exit 1
cp -r ../ui/dist ./webview

# Build ./extension.ts
node build-extension.cjs --minify
