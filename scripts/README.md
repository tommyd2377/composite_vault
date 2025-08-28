Generate IDL TypeScript helper

Usage:

node scripts/generate-idl-ts.mjs <path/to/idl.json> <out/idl.ts> [--address=<BASE58_ADDRESS>]

Example:

node scripts/generate-idl-ts.mjs target/idl/counter.json frontend/anchor-idl/counter.ts --address=8PY1q5J3Aq2z7TBDLBrVjv77mYzjXSCz6iHQaFEFw9hY

This produces a TS file that exports `IDL` as a const and `ProgramIdl` type alias.
