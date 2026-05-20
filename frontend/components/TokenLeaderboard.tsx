"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  CheckCircle2,
  Clipboard,
  Loader2,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import idl from "../anchor-idl/composite_vault.json";

const DEBUG_TOKEN_CHECK = false;

type TokenRow = {
  configPda: string;
  compositeMint: string;
  numAssets: number;
  decimals?: number;
  supply?: string;
  totalValueUSD?: number;
};

type ParsedTokenAccount = {
  pubkey?: unknown;
  data?: {
    parsed?: {
      info?: {
        tokenAmount?: {
          uiAmount?: number | string | null;
        };
      };
    };
  };
};

type ParsedTokenAccountItem = {
  pubkey?: unknown;
  account?: ParsedTokenAccount;
  parsed?: ParsedTokenAccount;
};

function shortAddress(value: string, chars = 5) {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function formatSupply(supply?: string, decimals?: number) {
  if (!supply) return "-";
  try {
    const raw = BigInt(supply);
    if (typeof decimals === "number" && decimals > 0) {
      const scale = BigInt(10) ** BigInt(decimals);
      const whole = raw / scale;
      const fraction = raw % scale;
      const fractionText = fraction
        .toString()
        .padStart(decimals, "0")
        .slice(0, 4)
        .replace(/0+$/, "");
      return fractionText
        ? `${whole.toLocaleString("en-US")}.${fractionText}`
        : whole.toLocaleString("en-US");
    }
    return raw.toLocaleString("en-US");
  } catch {
    return supply;
  }
}

function formatUsd(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Pending";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function TokenLeaderboard({ limit = 50 }: { limit?: number }) {
  const [data, setData] = useState<{ tokens: TokenRow[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

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
    return filtered.map((row) => ({
      ...row,
      totalValueUSD: valueMap.get(row.compositeMint),
    }));
  }, [data, valueMap]);
  const { publicKey } = useWallet();
  const wallet = useWallet();

  const [redeemingMint, setRedeemingMint] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const program = useMemo(() => {
    if (!connection || !wallet.publicKey) return null;
    try {
      if (!wallet.signTransaction || !wallet.signAllTransactions) {
        console.warn("Wallet missing required sign methods for Anchor");
        return null;
      }
      const provider = new anchor.AnchorProvider(
        connection,
        wallet as unknown as anchor.Wallet,
        { commitment: "confirmed" }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idlObj = idl as any;
      if (!idlObj?.address) {
        console.error("IDL missing address field; cannot instantiate Program");
        return null;
      }
      const prog = new anchor.Program(idlObj as anchor.Idl, provider);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (DEBUG_TOKEN_CHECK && (prog as any)?._programId?.toBase58) {
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
      const compositeMintPk = new PublicKey(compositeMintStr);
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), compositeMintPk.toBuffer()],
        program.programId
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfg: any = await (program.account as any).compositeConfig.fetch(
        configPda
      );
      const numAssets: number = cfg.numAssets;
      const mintPubkeys: string[] = cfg.mints
        .slice(0, numAssets)
        .map((m: PublicKey) => m.toString());

      const [mintAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_auth"), configPda.toBuffer()],
        program.programId
      );

      const userCompositeAta = await getAssociatedTokenAddress(
        compositeMintPk,
        wallet.publicKey
      );

      const vaultAtas: PublicKey[] = [];
      const userAtas: PublicKey[] = [];
      const preIxs: anchor.web3.TransactionInstruction[] = [];
      for (const mStr of mintPubkeys) {
        const mPk = new PublicKey(mStr);
        const vAta = await getAssociatedTokenAddress(mPk, mintAuthPda, true);
        const uAta = await getAssociatedTokenAddress(mPk, wallet.publicKey);
        const info = await connection.getAccountInfo(uAta);
        if (!info) {
          preIxs.push(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              uAta,
              wallet.publicKey,
              mPk
            )
          );
        }
        vaultAtas.push(vAta);
        userAtas.push(uAta);
      }

      const remaining = [
        ...mintPubkeys.map((m) => ({
          pubkey: new PublicKey(m),
          isSigner: false,
          isWritable: false,
        })),
        ...vaultAtas.map((v) => ({
          pubkey: v,
          isSigner: false,
          isWritable: true,
        })),
        ...userAtas.map((u) => ({
          pubkey: u,
          isSigner: false,
          isWritable: true,
        })),
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

  const [mintedMap, setMintedMap] = useState<Record<string, boolean | null>>({});
  const mintedCheckedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!publicKey || !connection) {
      mintedCheckedRef.current = new Set();
      setMintedMap({});
      return;
    }

    let mounted = true;

    const checkMinted = async (mint: string) => {
      if (DEBUG_TOKEN_CHECK)
        console.debug("checkMinted start", {
          mint,
          publicKey: publicKey?.toBase58?.(),
        });
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const maxRetries = 5;
      const baseDelay = 500;
      const cacheTtl = 1000 * 60 * 5;
      const pauseKey = "__sol_rpc_pause_until";

      const readCache = (
        pub: string,
        m: string
      ): { val: boolean; ts: number } | null => {
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
          const pauseUntil = getPauseUntil();
          if (pauseUntil && Date.now() < pauseUntil) {
            throw new Error("rpc-paused");
          }
          try {
            const mintPub = new PublicKey(mint);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore-next-line
            const res = await connection.getParsedTokenAccountsByOwner(publicKey, {
              mint: mintPub,
            });
            return res;
          } catch (err: unknown) {
            const msg = extractMessage(err);
            const lower = msg.toLowerCase();
            const code = extractCode(err);
            const is429 =
              lower.includes("429") ||
              lower.includes("too many requests") ||
              code === 429;
            attempt += 1;
            if (!is429 || attempt > maxRetries) throw err;
            const jitter = Math.floor(Math.random() * 200);
            const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
            console.warn(
              `Server responded with 429. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`
            );
            await sleep(delay);
            if (is429 && attempt >= 2) {
              const pauseMs = Math.min(60_000, baseDelay * Math.pow(2, attempt));
              setPauseUntil(Date.now() + pauseMs);
            }
          }
        }
        throw new Error("unreachable");
      };

      try {
        const cache = publicKey ? readCache(publicKey.toBase58(), mint) : null;
        if (DEBUG_TOKEN_CHECK) console.debug("cache read", { mint, cache });
        if (cache && Date.now() - cache.ts < cacheTtl) {
          setMintedMap((s) => ({ ...s, [mint]: cache.val }));
          return;
        }

        const res = await attemptGet();
        if (DEBUG_TOKEN_CHECK)
          console.debug("rpc res for mint", mint, {
            len: res?.value?.length,
            sample: res?.value?.slice(0, 3),
          });
        if (!mounted) return;

        let has = false;
        for (const item of res.value) {
          const parsedItem = item as ParsedTokenAccountItem;
          const account = parsedItem.account ?? parsedItem.parsed;
          if (DEBUG_TOKEN_CHECK) {
            try {
              const rawPubkey = parsedItem.pubkey ?? parsedItem.account?.pubkey;
              const pub =
                typeof rawPubkey === "string"
                  ? rawPubkey
                  : rawPubkey &&
                      typeof rawPubkey === "object" &&
                      "toString" in rawPubkey &&
                      typeof rawPubkey.toString === "function"
                    ? rawPubkey.toString()
                    : undefined;
              console.debug("parsed account", { mint, pub, raw: item });
            } catch (e) {
              console.debug("parsed account (error reading)", { mint, item, err: e });
            }
          }
          try {
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
        console.warn("Failed checking minted state for", mint, e);
        if (DEBUG_TOKEN_CHECK) console.debug("checkMinted error", { mint, err: e });
        if (extractMessage(e) === "rpc-paused") {
          setMintedMap((s) => ({ ...s, [mint]: null }));
          return;
        }
        setMintedMap((s) => ({ ...s, [mint]: null }));
      }
    };

    const toCheck = tokens
      .slice(0, limit)
      .map((t) => t.compositeMint)
      .filter((m) => !mintedCheckedRef.current.has(m));

    (async () => {
      for (const mint of toCheck) {
        if (!mounted) break;
        setMintedMap((s) => ({ ...s, [mint]: null }));
        await checkMinted(mint);
        mintedCheckedRef.current.add(mint);
        await new Promise((r) => setTimeout(r, 200));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [publicKey, connection, tokens, limit]);

  const visibleTokens = tokens.slice(0, limit);
  const isInitialLoading = isLoading && !data;

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => {
        setCopiedAddress((current) => (current === address ? null : current));
      }, 1400);
    } catch (copyError) {
      console.warn("Failed to copy address", copyError);
    }
  };

  return (
    <section className="blndr-surface overflow-hidden">
      <div className="border-b border-slate-800 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#00C2FF]">
              <ShieldCheck className="h-4 w-4" />
              Program discovery
            </div>
            <h2 className="text-2xl font-semibold text-white">
              Composite Leaderboard
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Live devnet composites discovered from the program, with vault
              value estimates and wallet-specific redeem status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="blndr-pill-accent">
              {isLoading && data ? "Refreshing" : `${tokens.length} entries`}
            </span>
            <span className="blndr-pill">
              {publicKey ? "Wallet checks on" : "Connect wallet to redeem"}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-5 sm:p-6">
        {redeemError ? (
          <div className="blndr-notice-error break-all">
            Redeem failed: {redeemError}
          </div>
        ) : null}
        {redeemSuccess ? (
          <div className="blndr-notice-success break-all">{redeemSuccess}</div>
        ) : null}
        {error ? (
          <div className="blndr-notice-error">
            Failed to load composites from /api/tokens. {error.message}
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="blndr-skeleton h-24" />
            ))}
          </div>
        ) : null}

        {!isInitialLoading && visibleTokens.length === 0 && !error ? (
          <div className="blndr-empty">
            No live devnet composites were found yet. Mint a composite from the
            create panel and it will appear here after discovery refreshes.
          </div>
        ) : null}

        {visibleTokens.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <div className="hidden grid-cols-[3rem_minmax(0,1.25fr)_7rem_8rem_9rem_10rem] gap-4 border-b border-slate-800 bg-slate-950/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
              <div>Rank</div>
              <div>Composite mint</div>
              <div>Assets</div>
              <div>Supply</div>
              <div>Vault value</div>
              <div className="text-right">Wallet status</div>
            </div>

            <div className="divide-y divide-slate-800">
              {visibleTokens.map((token, index) => {
                const minted = mintedMap[token.compositeMint];
                const isRedeeming = redeemingMint === token.compositeMint;

                return (
                  <div
                    key={token.compositeMint}
                    className="grid gap-4 bg-slate-950/55 px-4 py-4 transition hover:bg-slate-900/55 lg:grid-cols-[3rem_minmax(0,1.25fr)_7rem_8rem_9rem_10rem] lg:items-center"
                  >
                    <div className="flex items-center justify-between gap-3 lg:block">
                      <span className="text-xs uppercase tracking-[0.16em] text-slate-500 lg:hidden">
                        Rank
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-slate-200">
                        {index + 1}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <AddressButton
                          label={shortAddress(token.compositeMint, 6)}
                          address={token.compositeMint}
                          copied={copiedAddress === token.compositeMint}
                          onCopy={copyAddress}
                        />
                        <span className="rounded-md bg-slate-900 px-2 py-1 text-xs text-slate-400">
                          dec {token.decimals ?? "-"}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>config</span>
                        <AddressButton
                          label={shortAddress(token.configPda, 6)}
                          address={token.configPda}
                          copied={copiedAddress === token.configPda}
                          onCopy={copyAddress}
                        />
                      </div>
                    </div>

                    <Metric label="Assets" value={`${token.numAssets}`} />
                    <Metric
                      label="Supply"
                      value={formatSupply(token.supply, token.decimals)}
                    />
                    <Metric
                      label="Vault value"
                      value={formatUsd(token.totalValueUSD)}
                      valueClassName={
                        typeof token.totalValueUSD === "number"
                          ? "text-emerald-200"
                          : "text-slate-400"
                      }
                    />

                    <div className="flex items-center justify-between gap-3 lg:justify-end">
                      <span className="text-xs uppercase tracking-[0.16em] text-slate-500 lg:hidden">
                        Wallet status
                      </span>
                      <WalletAction
                        publicKey={publicKey}
                        minted={minted}
                        isRedeeming={isRedeeming}
                        onRedeem={() => handleRedeem(token.compositeMint)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AddressButton({
  label,
  address,
  copied,
  onCopy,
}: {
  label: string;
  address: string;
  copied: boolean;
  onCopy: (address: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      title={address}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-xs text-slate-200 transition hover:border-[#00C2FF]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00C2FF]/35"
      onClick={() => void onCopy(address)}
    >
      <span className="truncate">{label}</span>
      <Clipboard className="h-3 w-3 shrink-0 text-slate-500" />
      {copied ? (
        <span className="shrink-0 text-[10px] font-sans text-emerald-200">
          copied
        </span>
      ) : null}
    </button>
  );
}

function Metric({
  label,
  value,
  valueClassName = "text-slate-200",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 lg:block">
      <span className="text-xs uppercase tracking-[0.16em] text-slate-500 lg:hidden">
        {label}
      </span>
      <div className={`font-mono text-sm ${valueClassName}`}>{value}</div>
    </div>
  );
}

function WalletAction({
  publicKey,
  minted,
  isRedeeming,
  onRedeem,
}: {
  publicKey: PublicKey | null;
  minted: boolean | null | undefined;
  isRedeeming: boolean;
  onRedeem: () => void;
}) {
  if (!publicKey) {
    return (
      <span className="blndr-pill">
        <Wallet className="h-3.5 w-3.5" />
        No wallet
      </span>
    );
  }

  if (minted === true) {
    return (
      <button
        type="button"
        className="blndr-button-primary min-h-9 px-3 text-xs"
        disabled={isRedeeming}
        onClick={onRedeem}
      >
        {isRedeeming ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        {isRedeeming ? "Redeeming" : "Redeem"}
      </button>
    );
  }

  if (minted === false) {
    return (
      <span className="inline-flex min-h-8 items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 text-xs font-medium text-slate-400">
        <XCircle className="h-3.5 w-3.5" />
        Not in wallet
      </span>
    );
  }

  return (
    <span className="inline-flex min-h-8 items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 text-xs font-medium text-slate-400">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Checking holdings
    </span>
  );
}

export function CompositeLeaderboard(props: { limit?: number }) {
  return <TokenLeaderboard {...props} />;
}

export default TokenLeaderboard;
