# Blndr

Blndr is a Solana dApp for creating and redeeming basket-backed SPL tokens ("composite tokens").

The repository has two main parts:

- `composite_vault`: Anchor + Rust on-chain program that manages composite minting and redemption.
- `frontend`: Next.js + React app that lets users connect a wallet, build baskets, mint composites, browse composites, and redeem.

## What The System Does

- A user chooses multiple SPL tokens and deposit amounts.
- The on-chain program validates basket ratios and mints composite tokens.
- Underlying tokens are held in PDA-owned vault token accounts.
- When redeeming, composite tokens are burned and underlying assets are returned to the user.

## Tech Stack

- Smart contract: Rust, Anchor (`anchor-lang`, `anchor-spl`)
- Blockchain: Solana (configured for devnet)
- Frontend: Next.js 15, React 19, TypeScript
- Wallet/client: `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, Solana Wallet Adapter
- UI: Tailwind CSS 4, Radix UI, Sonner

## Repository Layout

```text
.
├── composite_vault/
│   ├── programs/composite_vault/src/lib.rs     # Anchor program
│   ├── tests/composite_vault.ts                # Anchor integration tests
│   └── Anchor.toml
├── frontend/
│   ├── app/                                    # Next App Router pages/layout
│   ├── components/                             # Wallet, create, leaderboard UI
│   ├── pages/api/                              # Next API routes
│   └── anchor-idl/composite_vault.json         # IDL consumed by frontend
└── README.md
```

## High-Level Architecture

```text
Wallet (Devnet)
   |
   v
Next.js Frontend (React + Anchor TS client)
   |                               \
   | on-chain tx                    \ HTTP
   v                                 v
Solana Program (composite_vault)   Next API Routes
   |                                 |
   v                                 v
PDA Vault ATAs + CompositeConfig   Solana RPC + DexScreener
```

## On-Chain Program Overview

Program ID (devnet):

- `HxGs1wgKnbVgC2FxqmgN7RcpuuaePbQUT5g3bNYBrPAo`

Key instructions:

- `deposit_and_mint_with_init`
  - First call for a new composite mint initializes:
    - composite mint
    - config PDA
    - vault ATAs (if needed)
  - Validates deposit ratios and mints composite tokens.
- `redeem_and_withdraw`
  - Burns composite tokens from user.
  - Transfers underlying tokens from vaults back to user.

Key account model:

- `CompositeConfig` stores:
  - authority
  - composite mint
  - mint authority PDA
  - up to `MAX_ASSETS = 8` underlying mints
  - normalized `amounts_per_unit` and `unit_scale`
- PDAs:
  - config PDA seeds: `["config", composite_mint]`
  - mint authority PDA seeds: `["mint_auth", config_pda]`

Basket math behavior:

- Per-unit basket amounts are normalized by GCD on init.
- Deposits must be exact multiples of per-unit amounts.
- All selected assets must imply the same basket multiplier `k`.
- Minted composite amount is `k`.

## Frontend Overview

Main UX:

- Wallet connect (devnet)
- "Create" flow (select tokens and amounts, submit deposit+mint)
- Composite leaderboard
- Redeem flow

Important frontend behavior:

- The app uses a Solana provider configured to devnet.
- The create flow filters out NFTs and existing composite tokens, then submits `depositAndMintWithInit`.
- The leaderboard polls API routes for discovered composites and estimated USD value.
- Redeem uses `redeemAndWithdraw` with dynamically derived remaining accounts.

## API Routes

### `GET /api/tokens`

- Scans program accounts for `CompositeConfig` using account discriminator filtering.
- Parses config data to list:
  - config PDA
  - composite mint
  - asset count
  - mint decimals/supply (when available)
- Uses cache (`TOKENS_CACHE_TTL_MS`, default `30000` ms).

### `GET /api/composites/value`

- Calls `/api/tokens` to discover composites.
- Reads vault balances for each composite's underlying assets.
- Fetches token prices from DexScreener.
- Returns total USD value per composite.
- Uses cache (`COMPOSITE_VALUE_CACHE_TTL_MS`, default `60000` ms).

## Local Development

### Prerequisites

- Rust + Cargo + Solana + Anchor toolchain
- Node.js 18+ (or newer)

### 1) Install dependencies

```bash
cd composite_vault
npm install

cd ../frontend
pnpm install
# or: npm install
```

### 2) Run on-chain tests

Run from `composite_vault`:

```bash
anchor test
```

This builds the program, starts a local validator, and runs integration tests in `tests/composite_vault.ts`.

### 3) Run frontend

Run from `frontend`:

```bash
pnpm dev
# or: npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables (Frontend)

Optional variables used by API routes:

- `SOLANA_RPC_URL` (default: `https://api.devnet.solana.com`)
- `TOKENS_CACHE_TTL_MS` (default: `30000`)
- `COMPOSITE_VALUE_CACHE_TTL_MS` (default: `60000`)
- `API_BASE_URL` (optional explicit base URL for internal API calls)

## IDL Sync Workflow

If you change the Anchor program interface, rebuild and copy the IDL to frontend:

```bash
cd composite_vault
anchor build
cp target/idl/composite_vault.json ../frontend/anchor-idl/composite_vault.json
```

## Notes

- Current wallet/provider UI is devnet-focused.
- Some component names still reference "counter" from earlier scaffolding, but active behavior is composite token mint/redeem.
- The home page currently uses:
  - create card (`WalletButton` + `SimpleLogButton`)
  - composite leaderboard (`TokenLeaderboard`)
