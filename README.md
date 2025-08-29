Composite — composite_vault

Monorepo containing:

- composite_vault: Anchor/Rust program implementing a composite token backed by a basket of SPL tokens.
- frontend: Next.js + React frontend used to discover tokens, build baskets, and call the composite_vault program.
- scripts: helper scripts for local dev, deployments, and tooling.

Quick start

1) Install dependencies
   - Node: install and run `npm install` inside `frontend`
   - Rust + Anchor: follow Anchor docs to install `cargo`, `rustup`, and `anchor`

2) Build & test (on-chain)
   - From the project root, run `anchor test` to build the program, start a local validator, and run integration tests.

3) Frontend
   - cd frontend
   - npm install
   - npm run dev

Notes

- The on-chain program is at `composite_vault/programs/composite_vault`.
- The frontend expects an Anchor IDL in `frontend/anchor-idl` and a configured RPC endpoint (see frontend env vars).
- This README consolidates per-folder READMEs. Subfolder READMEs were removed to keep one canonical entrypoint.

Contributing

Open a PR against `main`. Run unit and integration tests before pushing changes.

License

See the repository LICENSE (if present).
