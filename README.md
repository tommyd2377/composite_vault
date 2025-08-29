🧩 Blendr — Composite Token Vaults on Solana

Blendr is a Solana program + frontend for creating and managing composite tokens — single SPL tokens that represent a fixed basket of underlying assets.
Think of it as an ETF factory on-chain: deposit tokens into a vault, mint a composite token that’s always redeemable at NAV.

⸻

✨ Features
   •	Permissionless composites: Anyone can create a new basket of tokens with custom ratios.
   •	Canonical ratios: Baskets are normalized on-chain (e.g., [2,4] → [1,2]), so 1 composite token always represents a minimal basket.
   •	Mint & redeem:
   •	Deposit & Mint → swap assets for composite tokens.
   •	Redeem & Withdraw → burn composites to reclaim the underlying assets.
   •	Open-ended supply: Like ETFs, supply expands/contracts depending on demand.
   •	NAV enforcement: Arbitrage keeps market prices close to underlying vault value.
   •	Frontend (Next.js + Anchor client): Simple UI to select assets and mint your own basket.

⸻

📂 Project Structure
composite_vault/
├── programs/
│   └── composite_vault/   # Anchor smart contract
│       └── src/lib.rs     # Core program logic
├── tests/
│   └── composite_vault.ts # Mocha/TS tests for end-to-end flows
├── app/ or frontend/      # Next.js frontend (Blendr UI)
└── README.md              # This file

🛠 How It Works

1. Initialize a Composite
   •	Deploys a Config PDA storing basket ratios.
   •	Creates the Composite Mint (an SPL token).
   •	Sets up vault ATAs for each underlying token.
   •	Normalizes ratios via GCD so [2,4] is stored as [1,2].

2. Deposit & Mint
   •	User sends deposits into the vault ATAs.
   •	Program checks deposits match multiples of the configured per-unit basket.
   •	Mints k composite tokens (with decimals set at initialization).

3. Redeem & Withdraw
   •	Burn composite tokens from the user.
   •	Program transfers the proportional underlying assets from vault → user.

⸻

📦 Build & Deploy

Prereqs
   •	Rust + Cargo
   •	Solana CLI
   •	Anchor
   •	Node.js + Yarn

Build
anchor build
test
anchor test
Deploy (local validator)
acnhor deploy

🌐 Frontend (Blendr UI)
   •	Next.js + Tailwind frontend for creating and minting composites.
   •	Wallet adapter integrated (Phantom, Solflare, etc).
   •	Displays a Composite Leaderboard for recently created baskets.

Run locally:
npm i
npm run dev

Open http://localhost:3000.

⸻

💸 Fees & Incentives (planned)
   •	Mint / Redeem Fee: Protocol fee (e.g., 25–50 bps).
   •	Creator Royalty: Basket creators earn a cut when their composites are minted.
   •	Optional Trading Pools: Composites can be listed on Raydium/Orca for secondary trading.

⸻

🔮 Roadmap
   •	✅ MVP: init + deposit/mint + redeem/withdraw
   •	🚧 Frontend UX polish
   •	🚧 Creator fee-sharing
   •	🚧 Raydium auto-listing
   •	🚧 RWA integration (gold, T-bills, real estate tokens)
   •	🚧 Social layer: basket leaderboards, trending composites

⸻

⚠️ Disclaimer

This is experimental software. Do not use with mainnet funds until the program has undergone audits and security reviews.
