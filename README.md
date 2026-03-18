# SimpleAccount Transaction Explorer

Next.js app for exploring ERC4337 `SimpleAccount` transactions across supported chains.

It reads chain/platform metadata from the KAMI database, resolves each chain's `SimpleAccount`, and provides:

- chain selector
- infinite-scroll transaction listing (latest first)
- search by hash/address/contract
- transaction detail dialog with internal calls and ERC20/ERC721/ERC1155 transfer decoding
- database-first loading with Blockscout supplementation/backfill support

## Tech Stack

- Next.js 16 (App Router), React 19, TypeScript
- Prisma 7 (`prisma.config.ts` based config)
- PostgreSQL (`@prisma/adapter-pg`)
- `viem` for RPC and decoding
- `zod` for request validation
- React Query + Radix UI for UX

## Requirements

- Node.js 20+
- `pnpm`
- PostgreSQL database containing the required KAMI tables/data

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment template and update values:

```bash
cp .env.example .env.local
```

3. Generate Prisma client:

```bash
pnpm prisma:generate
```

4. Start development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

`DATABASE_URL` is required. Others are optional tuning/features.

```env
DATABASE_URL="postgresql://user:password@localhost:5432/kami"

# Optional tuning for /api/transactions RPC scan fallback
TX_SCAN_WINDOW=120
TX_SCAN_MAX_WINDOWS=8
TX_SCAN_MAX_MS=10000

# Optional Blockscout fallback/supplement (set per chain ID)
# BLOCKSCOUT_API_BASE_0x79a="https://soneium-minato.blockscout.com"
# BLOCKSCOUT_API_BASE_0x14a34="https://base-sepolia.blockscout.com"
BLOCKSCOUT_MAX_PAGES=12

# Optional auth for POST /api/transactions/backfill
BACKFILL_API_KEY="set-a-random-string"
```

## Scripts

- `pnpm dev` - run local dev server
- `pnpm build` - run `prisma generate` then production build
- `pnpm start` - run production server
- `pnpm lint` - run ESLint
- `pnpm test` - run Vitest tests
- `pnpm prisma:generate` - generate Prisma client
- `pnpm prisma:migrate:dev` - create/apply local migration
- `pnpm prisma:migrate:deploy` - apply migrations in deploy environment
- `pnpm prisma:studio` - open Prisma Studio

## API Endpoints

### `GET /api/chains`

Returns supported chains that have platform configuration (`SimpleAccount` available).

### `GET /api/transactions`

Query params:

- `chainId` (required)
- `cursor` (optional, hex block cursor like `0x123abc`)
- `q` (optional search term: hash/address/contract)
- `limit` (optional, `5..100`, default `25`)

Behavior:

- reads from DB first
- optionally supplements from Blockscout
- falls back to bounded RPC scan when needed

### `GET /api/transactions/[hash]`

Query params:

- `chainId` (required)

Returns:

- transaction core data and gas info
- decoded internal calls (best-effort from trace APIs)
- decoded ERC20/ERC721/ERC1155 transfers
- human-friendly address labels for known contracts/wallets

### `POST /api/transactions/backfill`

Optional header:

- `x-backfill-key` (required only when `BACKFILL_API_KEY` is set)

JSON body (all optional):

- `chainId`: backfill one chain (default: all configured chains)
- `fromDate`: ISO date string (default: `2026-03-01T00:00:00Z`)
- `batchSize`: per round size (`50..500`, default `200`)
- `maxRounds`: max pagination rounds (`1..500`, default `100`)

## Data Model Notes

`prisma/schema.prisma` is intentionally trimmed to the subset needed by this app:

- chain/platform resolution (`blockchain`, `platform`)
- transaction storage (`transaction`)
- address labeling sources (`payment_token`, `fundingWallet`, `platformWallet`, `user`, `collection`, `asset`, `voucher`)
- related project/product metadata for better NFT naming

## Validation

Before shipping changes:

```bash
pnpm lint
pnpm test
pnpm build
```
