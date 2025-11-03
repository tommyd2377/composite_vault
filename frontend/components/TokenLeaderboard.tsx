"use client";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import idl from "../anchor-idl/composite_vault.json";

// Enable verbose debug logs for token minted checks. Toggle off in production.
const DEBUG_TOKEN_CHECK = true;

type TokenRow = {
  configPda: string;
  compositeMint: string;
  numAssets: number;
  decimals?: number;
  supply?: string;
  totalValueUSD?: number;
};

export function TokenLeaderboard({ limit = 50 }: { limit?: number }) {
  const [data, setData] = useState<{ tokens: TokenRow[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
  // schedule refresh interval

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/tokens");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mounted) {
          if (DEBUG_TOKEN_CHECK) console.debug("/api/tokens ->", json);
          setData(json);
        }
      } catch (e: unknown) {
        if (mounted) setError(e as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    fetchData();
    const timer = window.setInterval(fetchData, 30_000);
    return () => {
      mounted = false;
      clearInterval(timer as unknown as number);
    };
  }, []);

  const { connection } = useConnection();
  const [valueMap, setValueMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!connection) return;
      try {
        const res = await fetch("/api/composites/value");
        if (!res.ok) throw new Error(`value api ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json)) return;
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const entry of json) {
          if (entry?.compositeMint) {
            map.set(entry.compositeMint, Number(entry.totalValueUSD ?? 0));
          }
        }
        setValueMap(map);
      } catch (err) {
        console.warn("Failed to load composite values", err);
      }
    };

    run();
    const timer = window.setInterval(run, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connection]);

  const tokens: TokenRow[] = useMemo(() => {
    const raw = data?.tokens || [];
    const filtered = raw.filter((row) => {
      if (!row.supply) return true;
      try {
        return BigInt(row.supply) > BigInt(0);
      } catch {
        return true;
      }
    });

    if (!valueMap.size) return filtered;
    return filtered.map((row) => ({ ...row, totalValueUSD: valueMap.get(row.compositeMint) }));
  }, [data, valueMap]);
  const { publicKey } = useWallet();
  const wallet = useWallet();

  // ---------------- Redeem State ----------------
  const [redeemingMint, setRedeemingMint] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);

  // Anchor program setup (lazy)
  const program = useMemo(() => {
    if (!connection || !wallet.publicKey) return null;
    try {
      if (!wallet.signTransaction || !wallet.signAllTransactions) {
        console.warn("Wallet missing required sign methods for Anchor");
        return null;
      }
      const provider = new anchor.AnchorProvider(connection, wallet as unknown as anchor.Wallet, { commitment: "confirmed" });
      // Anchor 0.31.1 constructor signature is new Program(idl, provider?) — programId comes from idl.address.
      // We previously passed (idl, programId, provider) which matched older Anchor versions and caused provider to be wrong.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idlObj = idl as any;
      if (!idlObj?.address) {
        console.error("IDL missing address field; cannot instantiate Program");
        return null;
      }
      const prog = new anchor.Program(idlObj as anchor.Idl, provider);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((prog as any)?._programId?.toBase58) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        console.debug("Anchor Program instantiated", (prog as any)._programId.toBase58());
      }
      return prog as anchor.Program;
    } catch (e) {
      console.error("Failed creating program", e);
      return null;
    }
  }, [connection, wallet]);

  const handleRedeem = async (compositeMintStr: string) => {
    if (!program || !wallet.publicKey) return;
    setRedeemError(null);
    setRedeemSuccess(null);
    setRedeemingMint(compositeMintStr);
    try {
      // Derive config PDA (same seeds as program)
      const compositeMintPk = new PublicKey(compositeMintStr);
      const [configPda] = PublicKey.findProgramAddressSync([
        Buffer.from("config"),
        compositeMintPk.toBuffer(),
      ], program.programId);

      // Fetch config account to learn num_assets and mints
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = await (program.account as any).compositeConfig.fetch(configPda);
      const numAssets: number = cfg.numAssets;
      const mintPubkeys: string[] = cfg.mints.slice(0, numAssets).map((m: PublicKey) => m.toString());

      // Derive mint_auth PDA
      const [mintAuthPda] = PublicKey.findProgramAddressSync([
        Buffer.from("mint_auth"),
        configPda.toBuffer(),
      ], program.programId);

      // User composite ATA
      const userCompositeAta = await getAssociatedTokenAddress(compositeMintPk, wallet.publicKey);

      // For each mint: derive vault ATA (owner = mint_auth) and user ATA
      const vaultAtas: PublicKey[] = [];
      const userAtas: PublicKey[] = [];
      const preIxs: anchor.web3.TransactionInstruction[] = [];
      for (const mStr of mintPubkeys) {
        const mPk = new PublicKey(mStr);
        const vAta = await getAssociatedTokenAddress(mPk, mintAuthPda, true);
        const uAta = await getAssociatedTokenAddress(mPk, wallet.publicKey);
        // create user ATA if missing
        const info = await connection.getAccountInfo(uAta);
        if (!info) {
          preIxs.push(createAssociatedTokenAccountInstruction(wallet.publicKey, uAta, wallet.publicKey, mPk));
        }
        vaultAtas.push(vAta);
        userAtas.push(uAta);
      }

      // remaining accounts order (matches tests):
      // [mints..., vaults..., user_token_accounts...]
      const remaining = [
        ...mintPubkeys.map((m) => ({ pubkey: new PublicKey(m), isSigner: false, isWritable: false })),
        ...vaultAtas.map((v) => ({ pubkey: v, isSigner: false, isWritable: true })),
        ...userAtas.map((u) => ({ pubkey: u, isSigner: false, isWritable: true })),
      ];

      const builder = program.methods
        .redeemAndWithdraw(new anchor.BN(1))
        .accounts({
          user: wallet.publicKey,
          compositeMint: compositeMintPk,
          config: configPda,
          mintAuth: mintAuthPda,
          userComposite: userCompositeAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts(remaining);
      if (preIxs.length) builder.preInstructions(preIxs);
      const txSig = await builder.rpc();

      setRedeemSuccess(`Redeemed 1 composite: ${txSig}`);
      // Invalidate minted cache for this composite mint so UI updates
      mintedCheckedRef.current.delete(compositeMintStr);
      setMintedMap((s) => ({ ...s, [compositeMintStr]: false }));
    } catch (e) {
      console.error("redeem error", e);
  const errObj = e as Error;
  const msg = errObj && errObj.message ? errObj.message : String(e);
      setRedeemError(msg);
    } finally {
      setRedeemingMint(null);
    }
  };

  // minted status per composite mint: true = user has >0, false = zero, null = unknown/loading
  const [mintedMap, setMintedMap] = useState<Record<string, boolean | null>>({});
  const mintedCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!publicKey || !connection) {
      // clear state when no wallet
      mintedCheckedRef.current = new Set();
      setMintedMap({});
      return;
    }

    let mounted = true;

    const checkMinted = async (mint: string) => {
      if (DEBUG_TOKEN_CHECK) console.debug("checkMinted start", { mint, publicKey: publicKey?.toBase58?.() });
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const maxRetries = 5;
      const baseDelay = 500; // ms
      const cacheTtl = 1000 * 60 * 5; // 5 minutes
      const pauseKey = "__sol_rpc_pause_until";

      const readCache = (pub: string, m: string): { val: boolean; ts: number } | null => {
        try {
          if (typeof window === "undefined") return null;
          const key = `minted:${pub}:${m}`;
          const raw = sessionStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") return null;
          return { val: !!parsed.val, ts: Number(parsed.ts) || 0 };
        } catch {
          return null;
        }
      };

      const writeCache = (pub: string, m: string, val: boolean) => {
        try {
          if (typeof window === "undefined") return;
          const key = `minted:${pub}:${m}`;
          const payload = JSON.stringify({ val, ts: Date.now() });
          sessionStorage.setItem(key, payload);
        } catch {
          // ignore
        }
      };

      const getPauseUntil = (): number | null => {
        try {
          if (typeof window === "undefined") return null;
          const raw = sessionStorage.getItem(pauseKey);
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      };

      const setPauseUntil = (ts: number) => {
        try {
          if (typeof window === "undefined") return;
          sessionStorage.setItem(pauseKey, String(ts));
        } catch {
          // ignore
        }
      };

      const extractMessage = (e: unknown): string => {
        if (typeof e === "string") return e;
        if (typeof e === "object" && e !== null) {
          const m = (e as { message?: unknown }).message;
          return typeof m === "string" ? m : String(e);
        }
        return String(e);
      };

      const extractCode = (e: unknown): number | undefined => {
        if (typeof e === "object" && e !== null) {
          const c = (e as { code?: unknown }).code;
          return typeof c === "number" ? c : undefined;
        }
        return undefined;
      };

      const attemptGet = async () => {
        let attempt = 0;
        while (attempt <= maxRetries) {
          // global pause check to avoid hammering RPC after 429s
          const pauseUntil = getPauseUntil();
          if (pauseUntil && Date.now() < pauseUntil) {
            throw new Error("rpc-paused");
          }
          try {
            const mintPub = new PublicKey(mint);
            // use parsed API to reliably get tokenAmount info
            // getParsedTokenAccountsByOwner returns parsed account info with tokenAmount
            // (some RPCs may not return parsed for getTokenAccountsByOwner)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore-next-line
            const res = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPub });
            return res;
          } catch (err: unknown) {
            // detect rate limit / 429 in message or code
            const msg = extractMessage(err);
            const lower = msg.toLowerCase();
            const code = extractCode(err);
            const is429 = lower.includes("429") || lower.includes("too many requests") || code === 429;
            attempt += 1;
            if (!is429 || attempt > maxRetries) throw err;
            // exponential backoff with jitter
            const jitter = Math.floor(Math.random() * 200);
            const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
            console.warn(`Server responded with 429. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
            await sleep(delay);
            // if we hit 429 repeatedly, set a short global pause to avoid other tabs/loops hitting the RPC
            if (is429 && attempt >= 2) {
              const pauseMs = Math.min(60_000, baseDelay * Math.pow(2, attempt)); // up to 60s
              setPauseUntil(Date.now() + pauseMs);
            }
          }
        }
        throw new Error("unreachable");
      };

      try {
        // check cache first
    const cache = publicKey ? readCache(publicKey.toBase58(), mint) : null;
    if (DEBUG_TOKEN_CHECK) console.debug("cache read", { mint, cache });
        if (cache && Date.now() - cache.ts < cacheTtl) {
          setMintedMap((s) => ({ ...s, [mint]: cache.val }));
          return;
        }

        const res = await attemptGet();
    if (DEBUG_TOKEN_CHECK) console.debug("rpc res for mint", mint, { len: res?.value?.length, sample: res?.value?.slice(0,3) });
        if (!mounted) return;

        let has = false;
        for (const item of res.value) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const account = (item as any).account ?? (item as any).parsed ?? item.account ?? item;
          if (DEBUG_TOKEN_CHECK) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pub = (item as any).pubkey || (item as any).account?.pubkey || (item as any).pubkey?.toString?.();
              console.debug("parsed account", { mint, pub, raw: item });
            } catch (e) {
              console.debug("parsed account (error reading)", { mint, item, err: e });
            }
          }
          try {
            // parsed account structure contains tokenAmount info when using parsed RPC
            // account.data.parsed.info.tokenAmount.uiAmount is the human-readable amount
            const amt = account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
            if (DEBUG_TOKEN_CHECK) console.debug("account amt", { mint, amt });
            if (typeof amt === "number" ? amt > 0 : Number(amt) > 0) {
              has = true;
              break;
            }
          } catch {
            // ignore parse errors
          }
        }

        setMintedMap((s) => {
          const next = { ...s, [mint]: has };
          if (DEBUG_TOKEN_CHECK) console.debug("setMintedMap", { mint, has, next });
          return next;
        });
        try {
          if (publicKey) writeCache(publicKey.toBase58(), mint, has);
        } catch {}
      } catch (e) {
        // on error, mark as unknown
        console.warn("Failed checking minted state for", mint, e);
        if (DEBUG_TOKEN_CHECK) console.debug("checkMinted error", { mint, err: e });
        // if rpc paused, respect it and leave state unknown
        if (extractMessage(e) === "rpc-paused") {
          setMintedMap((s) => ({ ...s, [mint]: null }));
          return;
        }
        setMintedMap((s) => ({ ...s, [mint]: null }));
      }
    };

    // check visible tokens sequentially to avoid RPC rate limits (429)
    const toCheck = tokens.slice(0, limit).map((t) => t.compositeMint).filter((m) => !mintedCheckedRef.current.has(m));

    (async () => {
      for (const mint of toCheck) {
        if (!mounted) break;
        // mark loading
        setMintedMap((s) => ({ ...s, [mint]: null }));
        await checkMinted(mint);
        mintedCheckedRef.current.add(mint);
        // small delay between RPCs to reduce chance of rate-limit
        await new Promise((r) => setTimeout(r, 200));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [publicKey, connection, tokens, limit]);

  return (
    <div className="bg-gray-900/80 rounded-lg p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Composite Leaderboard</h3>
        <div className="text-xs text-white/60">{isLoading ? "Loading…" : `${tokens.length} entries`}</div>
      </div>

      {redeemError && (
        <div className="text-xs text-red-400 mb-2 break-all">Redeem error: {redeemError}</div>
      )}
      {redeemSuccess && (
        <div className="text-xs text-emerald-400 mb-2 break-all">{redeemSuccess}</div>
      )}

      {error && <div className="text-red-400 text-sm">Failed to load tokens</div>}

      <ul className="divide-y divide-white/5">
        {tokens.slice(0, limit).map((t) => {
          const minted = mintedMap[t.compositeMint];
          return (
            <li key={t.compositeMint} className="py-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium truncate">{t.compositeMint}</div>
                <div className="text-xs text-white/60">config: {t.configPda} • assets: {t.numAssets}</div>
              </div>
              <div className="text-sm text-right">
                <div className="text-sm font-mono">{t.supply ?? "-"}</div>
                <div className="text-xs text-white/60">dec {t.decimals ?? "-"}</div>
                {typeof t.totalValueUSD === "number" && !Number.isNaN(t.totalValueUSD) && (
                  <div className="text-xs text-emerald-300 mt-1">${t.totalValueUSD.toFixed(2)}</div>
                )}

                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    className="px-2 py-1 text-xs rounded bg-green-600/90 hover:opacity-90"
                    onClick={() => console.log("Mint", t.compositeMint)}
                    disabled={!publicKey}
                  >
                    Mint
                  </button>

                  {minted === null && <span className="text-xs text-white/50">checking…</span>}

          {minted && (
                    <button
                      className="px-2 py-1 text-xs rounded bg-blue-600/90 hover:opacity-90 disabled:opacity-40"
                      disabled={!publicKey || redeemingMint === t.compositeMint}
            onClick={() => handleRedeem(t.compositeMint)}
                    >
                      {redeemingMint === t.compositeMint ? "Redeeming…" : "Redeem"}
                    </button>
                  )}

                  {minted === false && (
                    <span className="text-xs text-white/40">not minted</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default TokenLeaderboard;
