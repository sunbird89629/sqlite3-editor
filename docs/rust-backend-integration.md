# Rust 后端源码基线

`rust-backend/` 保存公开的 `yy0931/sqlite3-editor` 的 `rust-backend` 分支源码，基线为提交 `8be10de9499e7a83900b9e8da1f59306bf55aa69`（1.0.213）。该分支与本项目原有 `main` 没有共同 Git 历史，因此通过保留两条历史的合并引入。

当前 `ui/` 和 `vscode/` 是原有前端与 VS Code 扩展，继续使用 Python `vscode/server.py`。Rust 后端的消息格式和服务协议不同，目前未接入扩展，构建 VSIX 不会包含或运行 Rust 程序。商店版 1.0.214 的完整前端源码未包含在公开分支中，不能将此仓库视为该商店版的完整源码。

分别在仓库根目录运行前端和 Python 检查，在 `rust-backend/` 运行 `cargo test --locked`。上游 Rust CI 文件保存在 `rust-backend/.github/workflows/`，仅作参考，不会作为本仓库 GitHub Actions 工作流自动运行。

根目录 `LICENSE` 与 `rust-backend/LICENSE` 内容不同，分别保留；使用 Rust crate 前请阅读其许可证内容。
