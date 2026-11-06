---
name: sqlite-editor-install
description: 在此仓库构建 SQLite3 Editor 的 VSIX、安装到 VS Code 或检查本地安装；适用于打包、安装和排查构建依赖问题。
---

# 打包与安装 SQLite3 Editor

## 工作流

从当前源码执行完整流程时，依次检查工作区和依赖、递增版本、提交、确认工作区干净、打包、安装和验证。打包不等于安装；按用户要求执行对应步骤。

在仓库根目录检查 `git status --short` 和 `vscode/package.json`，记录扩展 ID、版本和 `engines.vscode`。检查差异，区分本次相关改动与无关或归属不明的改动；保留并报告后者，不擅自暂存、提交、清理或丢弃。

## 提交与打包前检查

完整打包安装流程中，按下方规则递增并核对版本后，检查 Git 状态和差异，运行 `git diff --check`，只提交本次相关代码和版本变更；存在其他已暂存改动时使用限定路径的提交方式，确保它们不进入本次提交并保留其暂存状态。提交信息概括实际修改并包含版本号，不跳过 Git hooks。提交失败时停止，不打包。除非用户另外要求，不推送或创建 Git tag。

每次从源码打包前，运行 `git status --porcelain`：只有输出为空才能打包。该检查涵盖已跟踪文件、暂存区和未跟踪文件，不包含 Git 忽略的文件。存在任何输出时停止并报告；完整流程中须在提交后再次执行此检查。仅打包时不自动提交，若版本递增或其他改动使工作区不干净，停止并由用户处理后再继续；继续同一次打包时不再次递增版本。

记录用于打包的提交 SHA。打包、安装或验证失败时，报告失败情况和已有提交 SHA，不自动撤销提交；同一次打包失败重试不重复递增版本或提交。仅安装已有 VSIX 或检查安装时，不要求工作区干净，也不自动提交。

## 打包

1. 确认根目录的 UI 依赖、`vscode/node_modules` 和 Rust/Cargo 已安装。`vscode` 不属于 npm workspace，有独立的 `package-lock.json`。优先按锁文件安装依赖；不要为解决依赖问题更新锁文件或升级项目依赖，除非任务明确要求。
2. 每次从当前源码新打包时，在 `vscode/` 将扩展补丁版本递增一次（例如 `3.0.1` → `3.0.2`），并同步 `package.json` 与 `package-lock.json` 的项目版本。用户指定具体版本或明确要求保持版本时，以用户要求为准。同一次打包失败重试或重新安装同一个 VSIX 不重复递增；仅安装已有 VSIX 或检查安装时不修改源码版本。不要创建 Git tag。

   ```sh
   npm version patch --no-git-tag-version
   ```

   核对 `package.json`、`package-lock.json` 顶层和根包版本一致，按上面的规则完成提交和打包前干净检查，再从 `vscode/` 打包。VSIX 文件名必须包含新版本，例如 `sqlite3-editor-3.0.2.vsix`。

   ```sh
   sqlite_editor_version=$(node -p "require('./package.json').version")
   sqlite_editor_dir=$(mktemp -d "${TMPDIR:-/tmp}/sqlite-editor.XXXXXXXX")
   sqlite_editor_vsix="$sqlite_editor_dir/sqlite3-editor-$sqlite_editor_version.vsix"
   npx vsce package --no-dependencies -o "$sqlite_editor_vsix"
   ```

   该命令自动运行 `vscode:prepublish`，构建 UI、扩展代码和当前构建机器平台的 Rust 后端。`--no-dependencies` 适用于当前扩展的 JS 依赖已被 esbuild 打进 `extension.js`；依赖结构变化时重新检查。Rust 可执行文件按操作系统及架构命名，只能直接验证当前构建平台；无匹配二进制时扩展回退到 Python。临时目录确保同版本重复打包不会覆盖已有文件；用户指定产物位置时使用指定位置。
3. 检查退出状态和 VSIX 内容，例如 `unzip -l "$sqlite_editor_vsix"`。至少应包含 `extension/extension.js`、`extension/server.py`、`extension/umsgpack.py`、`extension/bin/` 下的当前平台 Rust 二进制及其许可证，以及 `extension/webview/index.html` 和资源。检查 VSIX 内 `extension/package.json` 的版本与文件名一致，记录 VSIX 路径和版本。

## 安装与验证

仅在用户要求安装时，使用用户指定的编辑器和目标配置档案。若用户希望在当前 VS Code 窗口使用，先查看窗口右上角的 Manage 配置档案按钮或 VS Code 配置档案界面，确认当前 profile；不要把无 `--profile` 参数的默认档案结果当作当前窗口的结果。若目标不明确，先确认用户使用的窗口和实例。安装本地 VSIX 可能替换目标档案中同 ID 的扩展，先检查目标档案的当前版本。

```sh
code --profile 'VimMode' --list-extensions --show-versions | rg -i 'yy0931\.vscode-sqlite3-editor'
code --profile 'VimMode' --install-extension "$sqlite_editor_vsix" --force
code --profile 'VimMode' --list-extensions --show-versions | rg -i 'yy0931\.vscode-sqlite3-editor'
```

上面的 `VimMode` 是曾经实测的档案名，执行时替换为目标窗口实际使用的 profile；默认档案可省略 `--profile`。`sqlite_editor_vsix` 是上一步生成的带版本号文件路径；新 shell 中应使用记录的实际路径。不要凭示例档案名创建或切换用户档案。相同版本重新安装时使用 `--force`。

列表中的版本只能证明该 ID 在目标档案中已安装，不能证明扩展已启用，也不能区分版本相同的不同构建。到目标窗口的扩展详情页核对版本、来源、安装路径、启用状态和自动更新状态。若用户要求使用扩展且它被禁用，启用该目标扩展；如果用户明确要求保持禁用则遵从。需要证明安装了本次构建时，检查详情页实际安装路径中的 `extension.js` 及前端 JS 资源，与 VSIX 里的对应文件比较哈希；配置了自定义扩展目录时，以实际目标为准。

只有真正打开临时数据库并检查数据显示后，才能声称扩展宿主运行验证通过；使用新建的独立临时路径，避免修改用户数据库。Rust 二进制缺失时需要 Python 才能回退；部分终端工具也需要 Python，可用 `sqlite3-editor.pythonPath` 指定解释器。报告区分打包、目标档案安装、启用、文件匹配和运行验证各自结果。

## 已知问题

- 本机曾出现默认档案的 CLI 显示本地 `0.0.0`，但当前窗口的 `VimMode` 档案仍显示商店版 `1.0.214` 且全局禁用。对 `VimMode` 安装本地 VSIX 后仍需在目标档案启用；扩展详情显示 `0.0.0`、来源 `VSIX`、自动更新关闭后，才用临时数据库确认实际运行。页面保留商店文案或存在旧版本目录不能单独证明当前运行版本。
- VS Code 拒绝安装为不兼容时，检查 `engines.vscode` 是否错误地写成精确版本。曾有 `1.71.0` 无法安装到 `1.144.1`，改成 `^1.71.0` 后成功；修改兼容范围前确认项目最低版本和目标版本，并重新打包。
- 本机 Node 24 使用 npm 11 安装 `vscode` 子项目时，曾遇到旧锁文件与可选平台包不一致；脱离锁文件安装又可能解析到使用顶层 await 的 `temp-dir`，导致 CJS 打包失败。优先使用与旧锁文件兼容的 npm，并检查安装的实际依赖版本。曾在 macOS arm64 用 npm 8 按锁文件安装，再补齐与锁定 esbuild 版本匹配的 `esbuild-darwin-arm64` 可选二进制后成功打包；其他平台按实际架构处理，不直接套用该包。
- `pwsh` 未安装时，项目构建脚本会回退到 `build-dev.sh`；应以最终退出状态及产物判断是否成功。
