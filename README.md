# ClickHouse SQL Editor

**[Open the live demo](https://sql-editor-a-piloian.vercel.app/)**

Run ClickHouse SQL, inspect statement results, and explore the returned rows in a table or chart. The assistant can prepare SQL and suggest a view for your next run.

## Run locally

Run these commands from the project root, one level above `client`. If your terminal opens in `client`, run `cd ..` first.

```sh
./scripts/install.sh
./scripts/start.sh
```

Open `http://localhost:3030`. The client uses `VITE_APP_API_BASE=/api` for development. Vite forwards those requests to Express on port `8080`. Set `CLICKHOUSE_URL` in the root `.env` to use ClickHouse Cloud. With no URL configured, Express connects to an already-running instance at `http://localhost:8123`.
