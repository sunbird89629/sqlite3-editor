$script_dir = (Get-Location).Path

# Build ../ui/ and copy the bundle ./webview
cd "$script_dir"
if (Test-Path "./webview") {
  Remove-Item -Path "./webview" -Recurse -Force
}
cd "../ui"
npm run _build-dev
cd "$script_dir"
Copy-Item "../ui/dist" "./webview" -Recurse

# Build ./extension.ts
node build-extension.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node build-rust.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
