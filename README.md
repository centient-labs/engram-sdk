# Engram SDK

Engram developer ecosystem -- TypeScript SDK, structured logger, and write-ahead log.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@centient/sdk`](./packages/sdk/) | TypeScript SDK for Engram Memory Server | `npm install @centient/sdk` |
| [`@centient/logger`](./packages/logger/) | Structured logging with transport abstraction | `npm install @centient/logger` |
| [`@centient/wal`](./packages/wal/) | Write-ahead log for crash recovery | `npm install @centient/wal` |

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Requires Node.js >= 18 and pnpm.

## License

[MIT](./LICENSE)

---

Part of the [Centient Labs](https://github.com/centient-labs) ecosystem.
