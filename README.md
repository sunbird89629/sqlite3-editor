# MySQL Viewer for VSCode

A read-only MySQL browser for VS Code. It shows a database as pages of records, lets you sort and
filter them, and runs read-only SQL. Nothing in this extension writes to the database.

## What it does

- Browse the tables and views of one database, 10 records per page.
- Sort by any column and filter across all columns. The database does the work, so both apply to the
  whole result and not only to the visible page.
- Inspect a table: its columns, its indexes and its `CREATE TABLE` statement.
- Run `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `TABLE` and `VALUES` in the viewer or in a SQL document
  with `Ctrl+Enter`.
- Open a read-only JSON snapshot of a row in an editor tab.

Every statement the extension sends is checked twice: an allow list on the client, and a read-only
session on the server (`SET SESSION TRANSACTION READ ONLY`). `INSERT`, `UPDATE`, `DELETE`, DDL and
`SET` cannot run.

## Not supported

- Writing data or structure. Use a dedicated MySQL client.
- SQL completion, code lenses, syntax diagnostics and parameter binding. The extension has no SQL
  analysis engine.
- Detecting changes made by other clients. Use the **Refresh** button in the toolbar instead.
- Multiple databases per connection, connection pools, SSH tunnels and TLS client certificates.

## Configure a connection

Add entries to `sqlite3-editor.mysqlConnections`:

```json
{
  "sqlite3-editor.mysqlConnections": [
    {
      "id": "local",
      "name": "Local MySQL",
      "host": "127.0.0.1",
      "port": 3306,
      "user": "viewer",
      "password": "secret",
      "database": "app"
    }
  ]
}
```

`id`, `host` and `database` are required. Entries without them are ignored.

> The password is stored in plain text in your settings, so Settings Sync can copy it and a
> committed `settings.json` can expose it. Use a database user with read-only grants.

Run **SQLite3 Editor: Connect to MySQL** from the command palette and pick a connection. A session
opens in a new tab; closing the tab closes the connection.

## Development

```sh
npm install                 # installs ui and node-http workspaces
cd vscode && npm install    # the extension is not a workspace member

MYSQL_URL=mysql://user:password@127.0.0.1:3306/database npm start
```

`npm start` runs the webview (Vite, port 5173) and the development server (`node-http`, port 8080).
The development server speaks the same `/query` protocol as the extension host.

To run the extension itself, press F5 in VS Code with `vscode/` as the workspace folder, or build a
package:

```sh
cd vscode && ./build.sh && npx vsce package
```

## Tests

```sh
cd vscode && npm test       # read-only allow list
npm run test:ui             # Playwright, needs MySQL
```

The Playwright suite needs a MySQL 8 server and a database it can create tables in:

```sh
MYSQL_URL=mysql://root:root@127.0.0.1:3306/viewer_test MYSQL_ALLOW_WRITES=1 npm run test:ui
```

`MYSQL_ALLOW_WRITES=1` exposes a test-only `/test/execute` endpoint so that the suite can seed
fixtures. The extension itself never uses it.
