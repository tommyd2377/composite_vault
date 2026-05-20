/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Coins,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getMint as getTokenMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProgram } from "./hooks/useProgram";
import { WalletButton } from "./WalletButton";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

type TokenInfo = {
  address: string;
  mint?: string;
  amount: string | number | null;
  decimals?: number;
  name?: string;
  symbol?: string;
  isNft?: boolean;
  isComposite?: boolean;
};

function shortAddress(value?: string, chars = 4) {
  if (!value) return "Unknown";
  if (value === "SOL") return "Native SOL";
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

function formatAmount(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  if (amount === 0) return "0";
  if (amount < 0.0001) return "<0.0001";
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: amount >= 1000 ? 2 : 6,
  });
}

function tokenLabel(token: TokenInfo) {
  return token.symbol || token.name || shortAddress(token.mint ?? token.address);
}

export function TokenBlendBuilder() {
  const { publicKey, connection, program } = useProgram();
  const walletAddress = publicKey?.toBase58();
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmModalText, setConfirmModalText] = useState("");
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokenMap, setTokenMap] = useState<
    Record<string, { name?: string; symbol?: string }>
  >({});
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [hasFetchedAssets, setHasFetchedAssets] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);

  const fetchAssets = useCallback(async () => {
    if (!publicKey) {
      toast.error("Connect your wallet first");
      return;
    }

    setLoading(true);
    setAssetError(null);
    try {
      const lamports = await connection.getBalance(publicKey);
      const solBalance = lamports / LAMPORTS_PER_SOL;

      const resp = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const parsed = resp.value.map(({ pubkey, account }) => {
        const parsedData = (account.data as any).parsed;
        const info = parsedData?.info;
        const tokenAmount = info?.tokenAmount;
        let uiAmount: number | null = null;
        if (tokenAmount?.uiAmount != null) uiAmount = tokenAmount.uiAmount;
        else if (tokenAmount?.uiAmountString)
          uiAmount = parseFloat(tokenAmount.uiAmountString);
        else if (tokenAmount?.amount && tokenAmount?.decimals != null) {
          uiAmount =
            Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals);
        }

        const rawAmountStr = tokenAmount?.amount ?? "0";
        let rawAmount = BigInt(0);
        try {
          rawAmount = BigInt(
            typeof rawAmountStr === "string"
              ? rawAmountStr
              : Number(rawAmountStr)
          );
        } catch {
          rawAmount = BigInt(0);
        }
        const decimals = tokenAmount?.decimals;
        const looksLikeNft = decimals === 0 && rawAmount <= BigInt(1);

        return {
          address: pubkey.toBase58(),
          mint: info?.mint,
          amount: uiAmount ?? 0,
          decimals,
          name: undefined,
          symbol: undefined,
          isNft: looksLikeNft,
        } as TokenInfo;
      });

      const fungibleTokens = parsed.filter((token) => !token.isNft);

      const solEntry: TokenInfo = {
        address: "SOL",
        mint: "SOL",
        amount: solBalance,
        decimals: 9,
        symbol: "SOL",
        name: "Solana",
      };

      try {
        if (Object.keys(tokenMap).length === 0) {
          const listUrl =
            "https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json";
          const r = await fetch(listUrl);
          if (r.ok) {
            const jl = await r.json();
            const map: Record<string, { name?: string; symbol?: string }> = {};
            (jl.tokens || []).forEach((tk: any) => {
              if (tk.address)
                map[tk.address] = { name: tk.name, symbol: tk.symbol };
            });
            setTokenMap(map);
            fungibleTokens.forEach((token) => {
              const meta = map[token.mint as string];
              if (meta) {
                token.name = meta.name;
                token.symbol = meta.symbol;
              }
            });
          }
        } else {
          fungibleTokens.forEach((token) => {
            const meta = tokenMap[token.mint as string];
            if (meta) {
              token.name = meta.name;
              token.symbol = meta.symbol;
            }
          });
        }
      } catch (err) {
        console.warn("Failed to fetch token list", err);
      }

      try {
        const METADATA_PROGRAM_ID = new PublicKey(
          "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        );
        const missing = fungibleTokens.filter(
          (token) => !(token.symbol || token.name) && token.mint
        );
        if (missing.length > 0) {
          await Promise.all(
            missing.map(async (token) => {
              try {
                const mintPub = new PublicKey(token.mint as string);
                const [metaPda] = await PublicKey.findProgramAddress(
                  [
                    Buffer.from("metadata"),
                    METADATA_PROGRAM_ID.toBuffer(),
                    mintPub.toBuffer(),
                  ],
                  METADATA_PROGRAM_ID
                );
                const info = await connection.getAccountInfo(metaPda);
                if (info && info.data) {
                  const buf = info.data;
                  let offset = 1 + 32 + 32;
                  const dv = new DataView(
                    buf.buffer,
                    buf.byteOffset,
                    buf.byteLength
                  );
                  const nameLen = dv.getUint32(offset, true);
                  offset += 4;
                  const nameBytes = new Uint8Array(
                    buf.buffer,
                    buf.byteOffset + offset,
                    nameLen
                  );
                  const name = new TextDecoder()
                    .decode(nameBytes)
                    .replace(/\0+$/, "");
                  offset += nameLen;
                  const symLen = dv.getUint32(offset, true);
                  offset += 4;
                  const symBytes = new Uint8Array(
                    buf.buffer,
                    buf.byteOffset + offset,
                    symLen
                  );
                  const symbol = new TextDecoder()
                    .decode(symBytes)
                    .replace(/\0+$/, "");
                  if (name) token.name = name;
                  if (symbol) token.symbol = symbol;
                }
              } catch {
                // Ignore per-token metadata failures.
              }
            })
          );
        }
      } catch (err) {
        console.warn("Failed to fetch on-chain metadata", err);
      }

      try {
        const programId = program?.programId;
        if (programId) {
          await Promise.all(
            fungibleTokens
              .filter((token) => token.mint && token.mint !== "SOL")
              .map(async (token) => {
                if (!token.mint) return;
                try {
                  const mintPk = new PublicKey(token.mint);
                  const mintInfo = await getTokenMint(connection, mintPk);
                  if (mintInfo.decimals !== undefined) {
                    token.decimals = mintInfo.decimals;
                  }
                  const [configPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("config"), mintPk.toBuffer()],
                    programId
                  );
                  const [mintAuthPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("mint_auth"), configPda.toBuffer()],
                    programId
                  );
                  if (
                    mintInfo.mintAuthority &&
                    mintInfo.mintAuthority.equals(mintAuthPda)
                  ) {
                    token.isComposite = true;
                  }
                } catch (err) {
                  console.warn("Composite token detection failed", err);
                }
              })
          );
        }
      } catch (err) {
        console.warn("Failed determining composite tokens", err);
      }

      const filteredTokens = fungibleTokens.filter((token) => {
        if (token.isComposite) return false;
        const amt = Number(token.amount ?? 0);
        return Number.isFinite(amt) && amt > 0;
      });

      setTokens([solEntry, ...filteredTokens]);
      setHasFetchedAssets(true);
    } catch (err) {
      console.error("Failed to fetch assets", err);
      setAssetError("Could not load wallet assets. Try again in a moment.");
      setHasFetchedAssets(true);
      toast.error("Failed to fetch wallet assets (see console)");
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection, tokenMap, program]);

  useEffect(() => {
    setTokens([]);
    setSelections({});
    setHasFetchedAssets(false);
    setAssetError(null);
  }, [walletAddress]);

  const onToggleSelect = (t: TokenInfo) => {
    if (t.address === "SOL") return;
    setSelections((prev) => {
      const copy = { ...prev };
      if (t.address in copy) {
        delete copy[t.address];
      } else {
        copy[t.address] = "";
      }
      return copy;
    });
  };

  const onChangeAmount = (t: TokenInfo, raw: string) => {
    const filtered = raw.replace(/[^0-9.]/g, "");
    const available = Number(t.amount ?? 0);
    let valueNum = Number(filtered || 0);
    if (isNaN(valueNum)) valueNum = 0;
    if (valueNum > available) valueNum = available;

    setSelections((prev) => {
      const copy = { ...prev };
      if (t.address === "SOL") return copy;
      copy[t.address] = valueNum === 0 ? "" : String(valueNum);
      return copy;
    });
  };

  const resolveConfirm = useCallback((value: boolean) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmModalOpen(false);
    resolve?.(value);
  }, []);

  const handleConfirmDeposit = async () => {
    if (!publicKey) return toast.error("Connect your wallet first");

    const selected = tokens.filter((t) => t.mint && t.address in selections);
    if (selected.length === 0)
      return toast.error("Select at least one token and enter an amount");

    const selectedSpl = selected.filter((t) => t.mint && t.mint !== "SOL");
    if (selectedSpl.length === 0) {
      return toast.error(
        "SOL (native) cannot be deposited via this flow - select one or more SPL tokens"
      );
    }

    if (!program) return toast.error("Program not available");

    setProcessing(true);
    try {
      const compositeMintKeypair = Keypair.generate();

      const [configPda] = await PublicKey.findProgramAddress(
        [Buffer.from("config"), compositeMintKeypair.publicKey.toBuffer()],
        program.programId
      );

      const [mintAuthPda] = await PublicKey.findProgramAddress(
        [Buffer.from("mint_auth"), configPda.toBuffer()],
        program.programId
      );

      const mints: PublicKey[] = [];
      const vaults: PublicKey[] = [];
      const userAtas: PublicKey[] = [];
      const depositBNs: anchor.BN[] = [];
      const perBasketBNs: anchor.BN[] = [];
      const decimalsList: number[] = [];

      for (const t of selectedSpl) {
        const mintPub = new PublicKey(t.mint as string);
        mints.push(mintPub);

        const vault = await getAssociatedTokenAddress(mintPub, mintAuthPda, true);
        vaults.push(vault);

        const userAta = await getAssociatedTokenAddress(mintPub, publicKey);
        userAtas.push(userAta);

        const mintInfo = await getTokenMint(connection, mintPub);
        const decimals = mintInfo.decimals;
        decimalsList.push(decimals ?? 0);

        const rawInput = selections[t.address] ?? "0";
        const raw = BigInt(Math.floor(Number(rawInput) * Math.pow(10, decimals)));
        depositBNs.push(new anchor.BN(raw.toString()));

        const perBasket = BigInt(1) * BigInt(Math.pow(10, decimals));
        perBasketBNs.push(new anchor.BN(perBasket.toString()));
      }

      const tx = new anchor.web3.Transaction();
      for (let i = 0; i < vaults.length; i++) {
        const info = await connection.getAccountInfo(vaults[i]);
        if (!info) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              publicKey,
              vaults[i],
              mintAuthPda,
              mints[i]
            )
          );
        }
      }

      if (tx.instructions.length > 0) {
        if ((program.provider as any)?.sendAndConfirm) {
          await (program.provider as any).sendAndConfirm(tx, []);
        } else if ((program.provider as any)?.send) {
          await (program.provider as any).send(tx, []);
        } else {
          return toast.error(
            "Unable to send ATA creation transaction: provider send not available"
          );
        }
      }

      const userCompositeAta = await getAssociatedTokenAddress(
        compositeMintKeypair.publicKey,
        publicKey
      );

      const perUnitForCall: anchor.BN[] = [];
      let isInitLocal = false;
      try {
        const cfgInfo = await connection.getAccountInfo(configPda);
        if (!cfgInfo) {
          isInitLocal = true;
          for (const d of depositBNs) perUnitForCall.push(new anchor.BN(d.toString()));
        } else {
          for (const p of perBasketBNs)
            perUnitForCall.push(new anchor.BN(p.toString()));
        }
      } catch {
        for (const p of perBasketBNs)
          perUnitForCall.push(new anchor.BN(p.toString()));
      }

      if (isInitLocal) {
        const bigints = depositBNs.map((b) => BigInt(b.toString()));
        const bigGcd = (a: bigint, b: bigint): bigint => {
          a = a < BigInt(0) ? -a : a;
          b = b < BigInt(0) ? -b : b;
          while (b !== BigInt(0)) {
            const t = a % b;
            a = b;
            b = t;
          }
          return a;
        };
        const gcdArray = (arr: bigint[]) =>
          arr.reduce((acc, v) => bigGcd(acc, v), arr[0]);
        const gcd = gcdArray(bigints);
        const normalized = bigints.map((v) => v / gcd);
        const human = normalized.map((v, i) => {
          const dec = decimalsList[i] ?? 0;
          const denom = Number(BigInt(10) ** BigInt(dec));
          const val = Number(v) / denom;
          return `${val} ${
            tokens.find((t) => t.mint === mints[i].toBase58())?.symbol ?? ""
          }`.trim();
        });
        const msg = `You are creating a new composite token. 1 composite = ${human.join(
          " + "
        )}.`;
        setConfirmModalText(msg);
        const userOk = await new Promise<boolean>((res) => {
          confirmResolveRef.current = res;
          setConfirmModalOpen(true);
        });
        setConfirmModalOpen(false);
        confirmResolveRef.current = null;
        if (!userOk) return;
      }

      const validateDeposits = (deposits: anchor.BN[], perUnits: anchor.BN[]) => {
        if (deposits.length !== perUnits.length)
          return { ok: false, reason: "length mismatch" };
        let k: bigint | null = null;
        for (let i = 0; i < deposits.length; i++) {
          const amount = BigInt(deposits[i].toString());
          const per = BigInt(perUnits[i].toString());
          if (per <= BigInt(0))
            return { ok: false, reason: `invalid per-unit for index ${i}` };
          if (amount <= BigInt(0))
            return { ok: false, reason: `zero amount for index ${i}` };
          if (amount % per !== BigInt(0))
            return {
              ok: false,
              reason: `token ${i} amount not multiple of per-unit`,
            };
          const k_i = amount / per;
          if (k === null) k = k_i;
          else if (k !== k_i)
            return {
              ok: false,
              reason: `ratio mismatch: token ${i} gives k=${k_i} vs expected ${k}`,
            };
        }
        return { ok: true, k: k ?? BigInt(0) };
      };

      const v = validateDeposits(depositBNs, perUnitForCall);
      if (!v.ok) {
        toast.error(`Validation failed: ${v.reason}`);
        return;
      }

      const programInfo = await connection.getAccountInfo(program.programId);
      if (!programInfo) {
        const msg = `Program not found on-chain at ${program.programId.toBase58()}. Check network / deployment.`;
        console.error(msg);
        toast.error(msg);
      } else {
        try {
          const method = (program.methods as any)
            .depositAndMintWithInit(perUnitForCall, depositBNs, 2)
            .accounts({
              user: publicKey,
              compositeMint: compositeMintKeypair.publicKey,
              config: configPda,
              mintAuth: mintAuthPda,
              userComposite: userCompositeAta,
              systemProgram: anchor.web3.SystemProgram.programId,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .remainingAccounts([
              ...mints.map((m) => ({
                pubkey: m,
                isSigner: false,
                isWritable: false,
              })),
              ...vaults.map((v) => ({
                pubkey: v,
                isSigner: false,
                isWritable: true,
              })),
              ...userAtas.map((u) => ({
                pubkey: u,
                isSigner: false,
                isWritable: true,
              })),
            ])
            .signers([compositeMintKeypair]);

          const txSig = await method.rpc();
          console.log("depositAndMintWithInit tx:", txSig);
          toast.success("Deposit + mint submitted");
        } catch (err: any) {
          console.error("depositAndMintWithInit error:", err);
          try {
            if (typeof err.getLogs === "function") {
              const logs = await err.getLogs();
              console.error("Simulation logs:", logs);
              toast.error("Transaction simulation failed - see console logs");
            } else if (err instanceof Error && (err as any).logs) {
              console.error("Error logs:", (err as any).logs);
              toast.error("Transaction failed - see console logs");
            } else {
              toast.error("Deposit failed - see console for details");
            }
          } catch (inner) {
            console.error("Failed to read error logs", inner);
            toast.error("Deposit failed and logs could not be retrieved");
          }
        }
      }
    } finally {
      setProcessing(false);
    }
  };

  const nativeSol = tokens.find((token) => token.address === "SOL");
  const eligibleTokens = useMemo(
    () => tokens.filter((token) => token.address !== "SOL"),
    [tokens]
  );
  const selectedTokens = useMemo(
    () => eligibleTokens.filter((token) => token.address in selections),
    [eligibleTokens, selections]
  );
  const selectedWithAmounts = selectedTokens.filter(
    (token) => Number(selections[token.address] ?? 0) > 0
  );
  const canSubmit =
    Boolean(publicKey) &&
    selectedTokens.length > 0 &&
    selectedTokens.length === selectedWithAmounts.length &&
    !processing;

  return (
    <section className="blndr-surface overflow-hidden">
      <div className="border-b border-slate-800 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#14F195]">
              <Coins className="h-4 w-4" />
              Create blend
            </div>
            <h2 className="text-2xl font-semibold text-white">
              Build a composite token
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Select SPL assets from your wallet, enter deposit amounts, and
              submit the basket to mint a redeemable composite token.
            </p>
          </div>
          <span className="blndr-pill w-fit">
            <ShieldCheck className="h-3.5 w-3.5 text-[#14F195]" />
            Devnet vault backing
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-6">
        {!publicKey ? (
          <div className="blndr-empty">
            <div className="mb-3 flex items-center gap-2 text-slate-200">
              <Wallet className="h-4 w-4 text-[#00C2FF]" />
              <span className="font-medium">Connect a wallet to begin</span>
            </div>
            <p className="mb-4 max-w-lg leading-6">
              Blndr needs your devnet wallet to read eligible SPL token balances
              and prepare the mint transaction.
            </p>
            <WalletButton />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-white">
                  Wallet ready
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {shortAddress(walletAddress, 6)}
                </div>
              </div>
              <button
                type="button"
                className="blndr-button-secondary"
                onClick={fetchAssets}
                disabled={loading || processing}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {hasFetchedAssets ? "Refresh assets" : "Load wallet assets"}
              </button>
            </div>

            {assetError ? (
              <div className="blndr-notice-error">{assetError}</div>
            ) : null}

            {nativeSol ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-200">SOL balance</span>
                  <span className="font-mono text-xs text-slate-400">
                    {formatAmount(nativeSol.amount)} SOL
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Native SOL is shown for context. This flow deposits SPL tokens.
                </p>
              </div>
            ) : null}

            {!hasFetchedAssets && !loading ? (
              <div className="blndr-empty">
                Load wallet assets to choose the SPL tokens that will back the
                composite.
              </div>
            ) : null}

            {loading ? (
              <div className="grid gap-3">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="blndr-skeleton h-20" />
                ))}
              </div>
            ) : null}

            {hasFetchedAssets && !loading && eligibleTokens.length === 0 ? (
              <div className="blndr-empty">
                No eligible SPL tokens with positive balances were found in this
                wallet. Composite tokens and NFT-like accounts are hidden.
              </div>
            ) : null}

            {eligibleTokens.length > 0 ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">
                    Wallet assets
                  </h3>
                  <span className="text-xs text-slate-500">
                    {eligibleTokens.length} eligible
                  </span>
                </div>
                <div className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
                  {eligibleTokens.map((token) => {
                    const selected = token.address in selections;
                    return (
                      <div
                        key={token.address}
                        className={`grid gap-3 rounded-lg border p-3 transition sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center ${
                          selected
                            ? "border-[#14F195]/45 bg-emerald-400/10"
                            : "border-slate-800 bg-slate-950/70 hover:border-slate-700"
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onToggleSelect(token)}
                          className="flex min-w-0 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00C2FF]/40"
                        >
                          <span
                            className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              selected
                                ? "border-[#14F195] bg-[#14F195] text-slate-950"
                                : "border-slate-600 bg-slate-900"
                            }`}
                            aria-hidden="true"
                          >
                            {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-white">
                                {tokenLabel(token)}
                              </span>
                              {token.name && token.symbol ? (
                                <span className="text-xs text-slate-500">
                                  {token.name}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className="mt-1 block font-mono text-xs text-slate-500"
                              title={token.mint ?? token.address}
                            >
                              {shortAddress(token.mint ?? token.address, 6)}
                            </span>
                            <span className="mt-1 block text-xs text-slate-400">
                              Balance {formatAmount(token.amount)}
                            </span>
                          </span>
                        </button>

                        <div>
                          <label className="sr-only" htmlFor={`amount-${token.address}`}>
                            Amount for {tokenLabel(token)}
                          </label>
                          <input
                            id={`amount-${token.address}`}
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => {
                              if (!(token.address in selections)) {
                                setSelections((prev) => ({
                                  ...prev,
                                  [token.address]: "",
                                }));
                              }
                            }}
                            className="blndr-input text-right font-mono"
                            value={selections[token.address] ?? ""}
                            onChange={(e) => onChangeAmount(token, e.target.value)}
                            placeholder="0"
                          />
                          <div className="mt-1 text-right text-[11px] text-slate-500">
                            max {formatAmount(token.amount)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">
                  Basket preview
                </h3>
                <span className="text-xs text-slate-500">
                  {selectedTokens.length} assets selected
                </span>
              </div>

              {selectedTokens.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">
                  Select SPL assets above to preview the basket backing.
                </div>
              ) : (
                <div className="grid gap-2">
                  {selectedTokens.map((token) => (
                    <div
                      key={`preview-${token.address}`}
                      className="flex items-center justify-between gap-3 rounded-md bg-slate-900/70 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate font-medium text-slate-200">
                        {tokenLabel(token)}
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        {selections[token.address] || "0"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <p className="text-xs leading-5 text-slate-500">
                  The program validates ratios before minting. First-time
                  composites lock the submitted basket as the backing recipe.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="blndr-button-ghost"
                    onClick={() => setSelections({})}
                    disabled={processing || selectedTokens.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="blndr-button-primary"
                    onClick={handleConfirmDeposit}
                    disabled={!canSubmit}
                  >
                    {processing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Coins className="h-4 w-4" />
                    )}
                    {processing ? "Submitting" : "Deposit and mint"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={confirmModalOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) resolveConfirm(false);
          else setConfirmModalOpen(true);
        }}
      >
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm composite creation</DialogTitle>
            <DialogDescription className="text-slate-400">
              Review the basket recipe before sending the devnet transaction.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-sm leading-6 text-slate-200">
            {confirmModalText}
          </div>
          <DialogFooter>
            <button
              type="button"
              className="blndr-button-secondary"
              onClick={() => resolveConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="blndr-button-primary"
              onClick={() => resolveConfirm(true)}
            >
              Create composite
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function SimpleLogButton() {
  return <TokenBlendBuilder />;
}

export default TokenBlendBuilder;
