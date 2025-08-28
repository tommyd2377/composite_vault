composite_vault

An Anchor v0.31 program that mints a composite token representing a fixed basket of two SPL tokens. The program:
- Initializes a config PDA for a pair of mints `(mint_a, mint_b)`
- Creates a PDA-owned composite mint and two vault ATAs (one per underlying mint)
- Allows users to deposit exact multiples of `(amount_a_per_unit, amount_b_per_unit)` and mints `k` composite tokens

Repository layout:
- `programs/composite_vault/src/lib.rs`: On-chain program
- `tests/composite_vault.ts`: TypeScript test that sets up local mints, user, and PDAs
- `Anchor.toml`: Workspace, provider, and test script configuration

Prerequisites:
- Rust toolchain and Solana CLI
- Anchor CLI 0.31.1
- Node.js 18+

Install Anchor and toolchain:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1
avm use 0.31.1
```

Install JS deps:
```bash
npm i
```

Build program:
```bash
anchor build
# If target/deploy is missing the .so, you can also run:
cargo build-sbf --manifest-path programs/composite_vault/Cargo.toml --sbf-out-dir target/deploy
```

Run tests (Anchor manages validator and runs Mocha via Anchor.toml script):
```bash
anchor test
```

Manual test run (optional):
```bash
solana-test-validator --reset --quiet --ledger /tmp/solana-test-ledger &
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET=$HOME/.config/solana/id.json
npm test
```

Notes:
- Program ID is declared in `lib.rs` and `Anchor.toml` (`Fg6P...1uK`).
- The TS test currently only provisions accounts; integrate CPI calls to `initialize` and `deposit_and_mint` as you evolve the program.
