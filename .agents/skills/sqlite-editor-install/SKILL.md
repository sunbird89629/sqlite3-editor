---
name: sqlite-editor-install
description: 在此仓库构建 `yy0931.vscode-sqlite3-editor` 的 VSIX、安装到 VS Code 指定 profile，或检查本地安装；适用于打包、安装、回退和排查构建或安装问题。
---

# 打包与安装本仓库的扩展

本仓库的扩展已经只做 MySQL 只读查看（产品名 MySQL Viewer），扩展标识仍是 `yy0931.vscode-sqlite3-editor`。
技术栈只有 Node：`ui/`（Preact + Vite）、`node-http/`（开发期 HTTP 镜像）、`vscode/`（扩展宿主，`mysql2` 打进 `extension.js`）。
没有 Rust 可执行文件，也没有 Python 回退，因此 **VSIX 与平台无关**，不再需要交叉编译或平台检查。

## 工作流

依次是：检查工作区 → 递增版本 → 打包 → 验证 VSIX 内容 → 安装到目标 profile → 验证安装 → （可选）运行验证。
打包不等于安装；按用户要求执行对应步骤，并分开报告每一步的结果。

## 打包前检查

1. 在仓库根目录记录扩展标识、版本和 `engines.vscode`：

   ```sh
   cd vscode && node -p "const p=require('./package.json'); [p.publisher+'.'+p.name, p.version, p.engines.vscode].join(' | ')"
   ```

2. 依赖分两处：根目录的 npm workspace（`ui`、`node-http`），以及 `vscode/` 自己的 `package-lock.json`。缺依赖时按锁文件安装，不要为绕过安装失败而升级项目依赖：

   ```sh
   npm ci                 # 仓库根目录
   cd vscode && npm ci
   ```

   锁文件与 `package.json` 不同步时 `npm ci` 会直接失败。此时用 `npm i`，并按用户要求决定是否提交锁文件变动，不要为了“让它过”而升级无关依赖。

   新版 npm 默认阻止 install scripts，`esbuild` 二进制可能因此缺失，表现为构建时报 `You installed esbuild for another platform`。按提示放行后重建：

   ```sh
   npm install-scripts approve esbuild   # 或 npm rebuild esbuild
   ```

3. `git status --porcelain` 的规则：
   - 用户要求**发布级打包**时，输出必须为空；有未提交改动就停止并报告，不要代为提交或清理。
   - 用户只要求**本地打包测试**时，可以带未提交改动打包，但要记录：提交 SHA + “工作区有未提交改动”，并在报告里说明该 VSIX 不对应任何提交。

4. 打包前清掉本地遗留产物；它们会被 `vsce` 打进 VSIX：

   ```sh
   cd vscode && rm -rf webview bin __pycache__ .pytest_cache
   ```

## 递增版本

`vscode/` 是扩展包，根目录 `package.json` 不是；只改扩展版本：

```sh
cd vscode && npm version patch --no-git-tag-version
```

核对 `vscode/package.json` 与 `vscode/package-lock.json` 顶层和根包版本三者一致：

```sh
node -p "const p=require('./package.json'), l=require('./package-lock.json'); [p.version, l.version, l.packages[''].version].join(' ')"
```

- 每次从源码新打包递增一个补丁号；同一次打包失败重试或重复安装同一个 VSIX 不再递增。
- 用户指定版本时以用户要求为准。不要创建 Git tag，默认不推送。

## 打包

`vsce` 会执行 `vscode:prepublish` → `npm run build:prod`（`build.sh`/`build.ps1`），即构建 `ui`（压缩、无 sourcemap）、复制到 `vscode/webview/`、再用 `node build-extension.cjs --minify` 打包 `extension.ts`。**不要手工跳过这一步**，`extension.js` 内的 `msgpackr` 兼容补丁依赖该构建脚本。按 F5 调试用 `npm run build`（开发构建，保留 sourcemap）。

`vsce` 要求扩展目录内有 `LICENSE`，仓库根目录有 GPLv3：

```sh
cd vscode
cp ../LICENSE ./LICENSE
version=$(node -p "require('./package.json').version")
outdir=$(mktemp -d "${TMPDIR:-/tmp}/mysql-editor.XXXXXXXX")
vsix="$outdir/sqlite3-editor-$version.vsix"
npx vsce package --no-dependencies -o "$vsix"
rm -f LICENSE
echo "VSIX=$vsix"
```

- `--no-dependencies` 成立的前提是运行时依赖已被 esbuild 打进 `extension.js`（`mysql2`、`msgpackr`、`jsonc-parser`）。新增运行时依赖时先确认它确实被打包进去。
- 输出到临时目录，避免同版本重复打包互相覆盖；用户指定位置时用用户的位置。
- `vsce` 会改写包内 `package.json`（加入 `__metadata`、去掉 `scripts` 与 devDependencies），这是正常现象。
- **prepublish 必须走生产构建**：`vscode/package.json` 的 `vscode:prepublish` 指向 `build:prod`。4.0.2 之前它指向开发构建，VSIX 里因此多出约 3MB 的 `webview/assets/*.js.map`；4.0.3 起改为生产构建（9 文件、536KB）。F5 调试仍用 `npm run build`。

## 验证 VSIX 内容

```sh
unzip -l "$vsix"
unzip -p "$vsix" extension/package.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log(p.publisher+'.'+p.name,p.version,p.displayName);console.log('cmds:',(p.contributes.commands||[]).map(c=>c.command).join(','));console.log('settings:',Object.keys(p.contributes.configuration.properties).join(','))})"
```

期望恰好这 9 项（数量可随 UI 产物变化，但种类固定；生产构建不含 `.js.map`）：

```
extension/extension.js
extension/package.json
extension/LICENSE.txt
extension/webview/index.html
extension/webview/assets/*.js  *.css  vendor.LICENSE.txt
```

参考体积：4.0.3 为 9 个文件、约 536KB。若出现 `*.js.map`，说明 prepublish 又退回了开发构建。

出现以下任一项就说明 `.vscodeignore` 或清理漏了，停止并修正后重打：

- `extension/bin/`（旧 Rust 二进制残留）
- `extension/__pycache__/`、`extension/.pytest_cache/`
- `extension/*-test.cjs`、`extension/extension.ts`、`extension/mysql-client.ts`
- 包内版本与文件名版本不一致

## 安装到目标 profile

先确认目标 profile。同一扩展 id 会装在多个 profile 里，每个 profile 的安装与启用状态独立：

```sh
code --list-extensions --show-versions | grep -i 'yy0931\.vscode-sqlite3-editor'
code --profile 'VimMode' --list-extensions --show-versions | grep -i 'yy0931\.vscode-sqlite3-editor'
```

`~/.vscode/extensions/` 是共享目录，profile 只在 `~/Library/Application Support/Code/User/profiles/<location>/extensions.json` 里记录自己启用哪个版本。

**同一 id 的本地 VSIX 会替换目标 profile 内的商店版**。当前扩展 id 就是旧的 SQLite3 Editor，替换后该 profile 不再能打开 `.db` 文件。安装前先读出目标 profile 的现有版本并在报告里写明影响，安装后用同样命令确认版本；未指定的 profile 不要动。

```sh
code --profile 'VimMode' --install-extension "$vsix" --force
code --profile 'VimMode' --list-extensions --show-versions | grep -i 'yy0931\.vscode-sqlite3-editor'
```

安装后检查 profile 记录与文件一致性：

```sh
python3 - <<'PY'
import json, pathlib
profiles = pathlib.Path.home()/ "Library/Application Support/Code/User/profiles"
for f in sorted(profiles.glob("*/extensions.json")):
    for e in json.loads(f.read_text()):
        if "yy0931.vscode-sqlite3-editor" in json.dumps(e):
            loc = e["location"]
            print(f.parent.name, e["version"], e["metadata"].get("source"), "pinned=%s" % e["metadata"].get("pinned"), loc.get("fsPath") or loc.get("path"))
PY
```

第一列是 profile 的**位置名**（如 `-4ed0637a`），不是 `--profile` 接受的名字；名字与位置的对照在 `~/Library/Application Support/Code/User/globalStorage/storage.json` 的 `userDataProfiles`（`name` 与 `location`）。默认档案不在 `profiles/` 下，它的记录在 `~/.vscode/extensions/extensions.json`。

`source` 应为 `vsix`；`pinned: true` 表示不会被商店版本自动覆盖。再解包 VSIX 与安装目录逐文件比对哈希：

```sh
tmpd=$(mktemp -d) && unzip -q "$vsix" -d "$tmpd"
for f in extension.js package.json webview/index.html; do
  cmp -s "$tmpd/extension/$f" "$HOME/.vscode/extensions/yy0931.vscode-sqlite3-editor-<version>/$f" && echo "match $f" || echo "DIFFER $f"
done
rm -rf "$tmpd"
```

`package.json` 会因 `__metadata` 不一致，属正常；用 `diff <(python3 -m json.tool ...)` 确认差异仅此一项。

## 运行验证

新装的扩展要**重开窗口**才加载。仅凭 `--list-extensions` 的版本号不能证明扩展已加载或能工作。

准备一个连接（`sqlite3-editor.mysqlConnections`，密码明文存放，建议只读账号）：

```json
"sqlite3-editor.mysqlConnections": [
  { "id": "local", "name": "本地", "host": "127.0.0.1", "port": 3306, "user": "viewer", "password": "secret", "database": "your_db" }
]
```

执行命令 `SQLite3 Editor: Connect to MySQL`，然后至少确认：表清单出现、数据网格有记录、翻页与排序生效、`Schema` 页签有列与 `CREATE TABLE`、`Custom query` 里执行 `DELETE` 报只读错误。用独立测试库，不要指向用户正在使用的数据库。

没有现成 MySQL 时，可用临时数据目录起一个，测完即删（不需要 `brew services`）：

```sh
BM=$(brew --prefix mysql)
mysqld --initialize-insecure --datadir=/tmp/mv-data --basedir="$BM"
mysqld --datadir=/tmp/mv-data --basedir="$BM" --port=3307 --socket=/tmp/mv.sock --mysqlx=OFF --log-error=/tmp/mv.err &
mysql --socket=/tmp/mv.sock -uroot -e "CREATE DATABASE viewer_test; CREATE USER 'viewer'@'127.0.0.1' IDENTIFIED BY 'viewer'; GRANT ALL ON viewer_test.* TO 'viewer'@'127.0.0.1';"
```

## 回退

```sh
code --profile 'VimMode' --install-extension yy0931.vscode-sqlite3-editor --force
```

显式安装可回到商店版本（即使商店版本号更低）。回退后同样用 `--list-extensions --show-versions` 确认。

## 已知问题

- **旧产物混入 VSIX**：`vscode/.vscodeignore` 必须覆盖 `bin`、`**/__pycache__`、`**/.pytest_cache`、`*-test.cjs`、源码 `.ts`、`.tmp`、`_test_files`。曾因漏写而把旧 Rust 二进制（3.2MB）和 `__pycache__` 打进包。
- **`msgpackr` 的 `utf8Write` 越界**：`github:yy0931/msgpackr` 会用 `0xffffffff` 调 `Buffer.utf8Write`，Node 20+ 直接抛 `ERR_BUFFER_OUT_OF_BOUNDS`。`vscode/build-extension.cjs` 与 `node-http/build.mjs` 都内置了 esbuild 补丁；若打包后运行时报这个错，说明构建脚本被绕过或补丁未匹配（脚本会主动报错）。
- **`require("msgpackr")` 在 Node 侧不可用**：该 git 依赖未构建 `dist/node.cjs`，只有 ESM `import` 可用；写脚本探测协议时要走 ESM 或直接用打包产物。
- **`engines.vscode` 必须是范围**（`^1.71.0`）。写成精确版本会让 VS Code 以“不兼容”拒绝安装。
- **`node-http` 的 `/test/execute` 不是生产功能**：它只在 `MYSQL_ALLOW_WRITES=1` 时开放，供 Playwright 造数据；扩展本身从不调用它。验证扩展时不要指望它。
- **商店版本可能覆盖本地安装**：未 `pinned` 时 VS Code 会按商店最新版重装；本地测试包应确认 `pinned: true`，否则版本号回退到商店版本。
