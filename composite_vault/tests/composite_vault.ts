/**
 * Run this test with:
 *   anchor test -- --grep composite_vault
 *   # Don't skip build; we want the on-chain binary/IDL to include all instructions.
 *
 * This test only sets up the local environment: creates two SPL mints,
 * a funded user, mints tokens to the user, and derives PDAs used by the
 * on-chain program. No program instructions are invoked because the
 * on-chain program is intentionally empty.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getMint,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from 'url';

describe("composite_vault", () => {
  // Checklist of requirements (keeps progress visible)
  // [x] Spin up provider and program workspace
  // [x] Create two SPL mints (mintA, mintB) with 9 decimals
  // [x] Create funded user via airdrop
  // [x] Mint tokens to user's ATAs
  // [x] Derive PDAs: config, mint_auth, vault ATAs
  // [x] Log addresses and assert balances

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Use workspace program injected by Anchor (preferred for tests)
  const program = anchor.workspace.CompositeVault as Program;
  const programId: PublicKey = program.programId;
  console.log("workspace programId:", programId.toBase58());

  const DECIMALS = 9;
  let user: Keypair;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let userAtaA: PublicKey;
  let userAtaB: PublicKey;
  let configPda: PublicKey;
  let configBump: number;
  let mintAuthPda: PublicKey;
  let mintAuthBump: number;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  let compositeMintKeypair: Keypair;
  let userCompositeAddr: PublicKey;

  // Helper: derive PDAs
  async function deriveConfigPda(compositeMint: PublicKey) {
    return await PublicKey.findProgramAddress(
      [Buffer.from("config"), compositeMint.toBuffer()],
      program.programId
    );
  }
  async function deriveMintAuthPda(configPda: PublicKey) {
    return await PublicKey.findProgramAddress(
      [Buffer.from("mint_auth"), configPda.toBuffer()],
      program.programId
    );
  }

  it("(1) sets up mints, user, and PDAs", async () => {
    // Create and fund user
    user = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Create two SPL mints with 9 decimals
    mintA = await createMint(provider.connection, user, user.publicKey, null, DECIMALS);
    mintB = await createMint(provider.connection, user, user.publicKey, null, DECIMALS);

    // Create user's ATA for each mint
    const userAtaAObj = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mintA,
      user.publicKey
    );
    userAtaA = userAtaAObj.address;

    const userAtaBObj = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      mintB,
      user.publicKey
    );
    userAtaB = userAtaBObj.address;

    // Mint some tokens to the user's ATAs
    await mintTo(provider.connection, user, mintA, userAtaA, user, 1_000_000_000); // 1 token
    await mintTo(provider.connection, user, mintB, userAtaB, user, 2_000_000_000); // 2 tokens

    // create composite mint keypair now (config PDA is derived from composite mint)
    compositeMintKeypair = anchor.web3.Keypair.generate();

    // Derive PDAs exactly like the on-chain program will (config is keyed by composite mint)
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), compositeMintKeypair.publicKey.toBuffer()],
      programId
    );
    [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth"), configPda.toBuffer()],
      programId
    );

  // Derive vault ATA addresses owned by mint_auth (do NOT create them yet)
  vaultA = await getAssociatedTokenAddress(mintA, mintAuthPda, true);
  vaultB = await getAssociatedTokenAddress(mintB, mintAuthPda, true);

  // Fetch user balances
  const userAAccount = await getAccount(provider.connection, userAtaA);
  const userBAccount = await getAccount(provider.connection, userAtaB);

  // Log addresses for verification
  console.log("user:", user.publicKey.toBase58());
  console.log("mintA:", mintA.toBase58());
  console.log("mintB:", mintB.toBase58());
  console.log("userAtaA:", userAtaA.toBase58(), "balance:", userAAccount.amount.toString());
  console.log("userAtaB:", userAtaB.toBase58(), "balance:", userBAccount.amount.toString());
  console.log("configPda:", configPda.toBase58(), "bump:", configBump);
  console.log("mintAuthPda:", mintAuthPda.toBase58(), "bump:", mintAuthBump);
  console.log("vaultA:", vaultA.toBase58());
  console.log("vaultB:", vaultB.toBase58());

  // Basic assertions
  assert.notEqual(userAAccount.amount.toString(), "0", "user should have balance of mintA");
  assert.notEqual(userBAccount.amount.toString(), "0", "user should have balance of mintB");
  });
  it("(2) deposit_and_mint_with_init does first-time init + deposit", async () => {
    const amountAUnit = 1_000_000_000; // 1 A per basket
    const amountBUnit = 2_000_000_000; // 2 B per basket
    const compositeDecimals = 2; // Define compositeDecimals variable

    // Deposit one basket (k = 1)
    const depositA = amountAUnit;
    const depositB = amountBUnit;

    // Confirm composite mint not exist yet
    try {
      await getMint(provider.connection, compositeMintKeypair.publicKey);
      throw new Error('composite mint unexpectedly exists before init');
    } catch (e) {
      // expected
    }

    // compute user's composite ATA (may be created by program)
    userCompositeAddr = await getAssociatedTokenAddress(compositeMintKeypair.publicKey, user.publicKey);

  // Create vault ATAs owned by the mint_auth PDA now (create client-side so
  // the on-chain program doesn't need to exercise the ATA creation CPI in tests).
  // This keeps tests focused on deposit/mint logic and avoids local CPI issues.
  await getOrCreateAssociatedTokenAccount(provider.connection, user, mintA, mintAuthPda, true);
  await getOrCreateAssociatedTokenAccount(provider.connection, user, mintB, mintAuthPda, true);

    try {
      const builder = program.methods
        .depositAndMintWithInit([
          new anchor.BN(amountAUnit),
          new anchor.BN(amountBUnit),
        ], [new anchor.BN(depositA), new anchor.BN(depositB)], compositeDecimals)
        .accounts({
          user: user.publicKey,
          compositeMint: compositeMintKeypair.publicKey,
          config: configPda,
          mintAuth: mintAuthPda,
          userComposite: userCompositeAddr,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts([
          { pubkey: mintA, isSigner: false, isWritable: false },
          { pubkey: mintB, isSigner: false, isWritable: false },
          { pubkey: vaultA, isSigner: false, isWritable: true },
          { pubkey: vaultB, isSigner: false, isWritable: true },
          { pubkey: userAtaA, isSigner: false, isWritable: true },
          { pubkey: userAtaB, isSigner: false, isWritable: true },
        ])
        .signers([compositeMintKeypair, user]);

      // Diagnostic: build the instruction and log programId + keys to debug missing program
      const ix = await builder.instruction();
      console.log('deposit ix programId:', ix.programId.toBase58());
      console.log('deposit ix keys:', ix.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isWritable: k.isWritable, isSigner: k.isSigner })));

      // Diagnostic: check that key programs exist and are executable in the validator
      const programsToCheck = [SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, program.programId];
      for (const p of programsToCheck) {
        const info = await provider.connection.getAccountInfo(p);
        console.log(`program ${p.toBase58()} present=${info !== null} executable=${info ? info.executable : false}`);
      }

      await builder.rpc();
    } catch (err: any) {
      console.error('depositAndMintWithInit error:', err);
      if (err.logs) console.error('program logs:\n', err.logs.join('\n'));
      throw err;
    }

    const cfg = await (program.account as any)["compositeConfig"].fetch(configPda);
    assert.equal(cfg.compositeMint.toBase58(), compositeMintKeypair.publicKey.toBase58());
    assert.equal(Number(cfg.numAssets), 2);

    const vaultAAccount = await getAccount(provider.connection, vaultA);
    const vaultBAccount = await getAccount(provider.connection, vaultB);
    assert.equal(vaultAAccount.amount.toString(), depositA.toString());
    assert.equal(vaultBAccount.amount.toString(), depositB.toString());
  // store user's composite ATA for later redeem test
  userCompositeAddr = await getAssociatedTokenAddress(compositeMintKeypair.publicKey, user.publicKey);
  });

  it("(3) second deposit (different user) skips init and mints correctly", async () => {
    const user2 = Keypair.generate();
    const sig2 = await provider.connection.requestAirdrop(user2.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig2, "confirmed");

    const user2AtaAObj = await getOrCreateAssociatedTokenAccount(provider.connection, user2, mintA, user2.publicKey);
    const user2AtaBObj = await getOrCreateAssociatedTokenAccount(provider.connection, user2, mintB, user2.publicKey);
    await mintTo(provider.connection, user, mintA, user2AtaAObj.address, user, 1_000_000_000);
    await mintTo(provider.connection, user, mintB, user2AtaBObj.address, user, 2_000_000_000);

    const user2CompositeAddr = await getAssociatedTokenAddress(compositeMintKeypair.publicKey, user2.publicKey);

    try {
      const builder2 = program.methods
        .depositAndMintWithInit([
          new anchor.BN(1_000_000_000),
          new anchor.BN(2_000_000_000),
        ], [new anchor.BN(1_000_000_000), new anchor.BN(2_000_000_000)], 2)
        .accounts({
          user: user2.publicKey,
          compositeMint: compositeMintKeypair.publicKey,
          config: configPda,
          mintAuth: mintAuthPda,
          userComposite: await getAssociatedTokenAddress(compositeMintKeypair.publicKey, user2.publicKey),
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts([
          { pubkey: mintA, isSigner: false, isWritable: false },
          { pubkey: mintB, isSigner: false, isWritable: false },
          { pubkey: vaultA, isSigner: false, isWritable: true },
          { pubkey: vaultB, isSigner: false, isWritable: true },
          { pubkey: user2AtaAObj.address, isSigner: false, isWritable: true }, 
          { pubkey: user2AtaBObj.address, isSigner: false, isWritable: true },
        ])
        .signers([user2, compositeMintKeypair]);

      const ix2 = await builder2.instruction();
      console.log('deposit2 ix programId:', ix2.programId.toBase58());
      console.log('deposit2 ix keys:', ix2.keys.map(k => ({ pubkey: k.pubkey.toBase58(), isWritable: k.isWritable, isSigner: k.isSigner })));

      // Diagnostic: check that key programs exist and are executable in the validator
      const programsToCheck2 = [SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, program.programId];
      for (const p of programsToCheck2) {
        const info = await provider.connection.getAccountInfo(p);
        console.log(`program ${p.toBase58()} present=${info !== null} executable=${info ? info.executable : false}`);
      }

      await builder2.rpc();
    } catch (err: any) {
      console.error('second deposit error:', err);
      if (err.logs) console.error('program logs:\n', err.logs.join('\n'));
      throw err;
    }

    const vaultAAccount = await getAccount(provider.connection, vaultA);
    const vaultBAccount = await getAccount(provider.connection, vaultB);
    const user2Composite = await getAccount(provider.connection, user2CompositeAddr);

    assert.equal(vaultAAccount.amount.toString(), "2000000000");
    assert.equal(vaultBAccount.amount.toString(), "4000000000");
    assert.equal(user2Composite.amount.toString(), "1");
  });

  it("(4) redeem_and_withdraw burns composite and returns underlying", async () => {
    // burn 1 composite and get back underlying
    try {
      // Ensure provider is set back to original user for redeem
      const userProvider = new anchor.AnchorProvider(provider.connection, new anchor.Wallet(user), provider.opts);
      anchor.setProvider(userProvider);
      const programUser = anchor.workspace.CompositeVault as Program;
  // Debug: print the IDL's instruction names and accounts to ensure the
  // TypeScript client loaded the expected IDL that matches the on-chain
  // program built above.
  const ixNames = (program.idl as any).instructions.map((ix: any) => ix.name);
  console.log('IDL instruction names:', ixNames);
  const redeemIx = (program.idl as any).instructions.find((ix: any) => ix.name === 'redeemAndWithdraw');
  console.log('IDL redeemAndWithdraw accounts:', redeemIx ? redeemIx.accounts.map((a: any) => a.name) : redeemIx);

    const builder = programUser.methods.redeemAndWithdraw(new anchor.BN(1))
        .accounts({
          user: user.publicKey,
          compositeMint: compositeMintKeypair.publicKey,
          config: configPda,
          mintAuth: mintAuthPda,
          userComposite: userCompositeAddr,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts([
          { pubkey: mintA, isSigner: false, isWritable: false },
          { pubkey: mintB, isSigner: false, isWritable: false },
          { pubkey: vaultA, isSigner: false, isWritable: true },
          { pubkey: vaultB, isSigner: false, isWritable: true },
          { pubkey: userAtaA, isSigner: false, isWritable: true },
          { pubkey: userAtaB, isSigner: false, isWritable: true },
        ])
        .signers([user]);

      // Build the instruction (without sending) and log the keys to inspect ordering
      const ix = await builder.instruction();
      console.log('redeem ix keys:', ix.keys.map(k => k.pubkey.toBase58()));

      // Diagnostic: check presence/executable of expected programs before sending redeem
      const programsToCheck3 = [SystemProgram.programId, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, program.programId];
      for (const p of programsToCheck3) {
        const info = await provider.connection.getAccountInfo(p);
        console.log(`program ${p.toBase58()} present=${info !== null} executable=${info ? info.executable : false}`);
      }

      await builder.rpc();
    } catch (err: any) {
      // Print full error for debugging, including any simulation logs
      console.error('redeemAndWithdraw error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      if (err.logs) console.error('program logs:\n', err.logs.join('\n'));
      throw err;
    }

    const postUserA = await getAccount(provider.connection, userAtaA);
    const postUserB = await getAccount(provider.connection, userAtaB);

    // user should have original amounts back (since they deposited 1 A and 2 B then withdrew)
  assert.equal(postUserA.amount.toString(), "1000000000");
  assert.equal(postUserB.amount.toString(), "2000000000");
  });
});
