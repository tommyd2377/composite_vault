/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState, useRef, useEffect } from "react";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getMint as getTokenMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { toast } from "sonner";
import { useProgram } from "./hooks/useProgram";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

type TokenInfo = {
  address: string;
  mint?: string;
  amount: string | number | null;
  decimals?: number;
  name?: string;
  symbol?: string;
};

export function SimpleLogButton() {
  const { publicKey, connection, program } = useProgram();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmModalText, setConfirmModalText] = useState("");
  const confirmResolveRef = useRef<(v: boolean) => void | null>(null);
  // sol balance is available via tokens[0] after fetch; keep state minimal
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokenMap, setTokenMap] = useState<Record<string, { name?: string; symbol?: string }>>({});
  const [selections, setSelections] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const fetchAssets = async () => {
    if (!publicKey) return toast.error("Connect your wallet first");
    setLoading(true);
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
        else if (tokenAmount?.uiAmountString) uiAmount = parseFloat(tokenAmount.uiAmountString);
        else if (tokenAmount?.amount && tokenAmount?.decimals != null)
          uiAmount = Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals);

        return {
          address: pubkey.toBase58(),
          mint: info?.mint,
          amount: uiAmount ?? 0,
          decimals: tokenAmount?.decimals,
          name: undefined,
          symbol: undefined,
        } as TokenInfo;
      });

      const solEntry: TokenInfo = {
        address: "SOL",
        mint: "SOL",
        amount: solBalance,
        decimals: 9,
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
              if (tk.address) map[tk.address] = { name: tk.name, symbol: tk.symbol };
            });
            setTokenMap(map);
            parsed.forEach((p) => {
              const meta = map[p.mint as string];
              if (meta) {
                p.name = meta.name;
                p.symbol = meta.symbol;
              }
            });
          }
        } else {
          parsed.forEach((p) => {
            const meta = tokenMap[p.mint as string];
            if (meta) {
              p.name = meta.name;
              p.symbol = meta.symbol;
            }
          });
        }
      } catch (err) {
        console.warn("Failed to fetch token list", err);
      }

      try {
        const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
        const missing = parsed.filter((p) => !(p.symbol || p.name) && p.mint);
        if (missing.length > 0) {
          await Promise.all(
            missing.map(async (p) => {
              try {
                const mintPub = new PublicKey(p.mint as string);
                const [metaPda] = await PublicKey.findProgramAddress(
                  [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mintPub.toBuffer()],
                  METADATA_PROGRAM_ID
                );
                const info = await connection.getAccountInfo(metaPda);
                if (info && info.data) {
                  const buf = info.data;
                  let offset = 1 + 32 + 32;
                  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                  const nameLen = dv.getUint32(offset, true);
                  offset += 4;
                  const nameBytes = new Uint8Array(buf.buffer, buf.byteOffset + offset, nameLen);
                  const name = new TextDecoder().decode(nameBytes).replace(/\0+$/, "");
                  offset += nameLen;
                  const symLen = dv.getUint32(offset, true);
                  offset += 4;
                  const symBytes = new Uint8Array(buf.buffer, buf.byteOffset + offset, symLen);
                  const symbol = new TextDecoder().decode(symBytes).replace(/\0+$/, "");
                  if (name) p.name = name;
                  if (symbol) p.symbol = symbol;
                }
              } catch {
                // ignore per-token errors
              }
            })
          );
        }
      } catch (err) {
        console.warn("Failed to fetch on-chain metadata", err);
      }

      setTokens([solEntry, ...parsed]);
    } catch (err) {
      console.error("Failed to fetch assets", err);
      toast.error("Failed to fetch wallet assets (see console)");
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = async () => {
    if (!open) {
      await fetchAssets();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const onToggleSelect = (t: TokenInfo) => {
  // don't allow selecting native SOL here (not an SPL token)
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
  // don't allow editing amounts for SOL (not an SPL token in this flow)
  if (t.address === "SOL") return copy;
  copy[t.address] = valueNum === 0 ? "" : String(valueNum);
      return copy;
    });
  };

  const handleConfirmDeposit = async () => {
    if (!publicKey) return toast.error("Connect your wallet first");

    const selected = tokens.filter((t) => t.mint && t.address in selections);
    if (selected.length === 0) return toast.error("Select at least one token and enter an amount");

    // Prevent passing the literal string "SOL" to PublicKey — SOL is native lamports, not an SPL mint
    const selectedSpl = selected.filter((t) => t.mint && t.mint !== "SOL");
    if (selectedSpl.length === 0) {
      return toast.error("SOL (native) cannot be deposited via this flow — select one or more SPL tokens");
    }

    if (!program) return toast.error("Program not available");

    setProcessing(true);
    try {
      const compositeMintKeypair = Keypair.generate();

      const [configPda] = await PublicKey.findProgramAddress([
        Buffer.from("config"),
        compositeMintKeypair.publicKey.toBuffer(),
      ], program.programId);

      const [mintAuthPda] = await PublicKey.findProgramAddress([
        Buffer.from("mint_auth"),
        configPda.toBuffer(),
      ], program.programId);

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
          tx.add(createAssociatedTokenAccountInstruction(publicKey, vaults[i], mintAuthPda, mints[i]));
        }
      }

      if (tx.instructions.length > 0) {
        // send via provider on program so wallet signs
        if ((program.provider as any)?.sendAndConfirm) {
          await (program.provider as any).sendAndConfirm(tx, []);
        } else if ((program.provider as any)?.send) {
          await (program.provider as any).send(tx, []);
        } else {
          return toast.error("Unable to send ATA creation transaction: provider send not available");
        }
      }

      const userCompositeAta = await getAssociatedTokenAddress(compositeMintKeypair.publicKey, publicKey);

      // Determine whether we're initializing a new config (first-time init)
      // If the config PDA does not exist, use the selected deposit amounts as the amounts_per_unit
      const perUnitForCall: anchor.BN[] = [];
      let isInitLocal = false;
      try {
        const cfgInfo = await connection.getAccountInfo(configPda);
        if (!cfgInfo) {
          // first-time init: use deposit amounts as the per-unit amounts
          isInitLocal = true;
          for (const d of depositBNs) perUnitForCall.push(new anchor.BN(d.toString()));
        } else {
          // existing config: use the canonical per-basket amounts we computed
          for (const p of perBasketBNs) perUnitForCall.push(new anchor.BN(p.toString()));
        }
      } catch {
        // fallback: use defaults
        for (const p of perBasketBNs) perUnitForCall.push(new anchor.BN(p.toString()));
      }

      // If this is an init, show a confirmation with the normalized (gcd-reduced) basket
      if (isInitLocal) {
        // compute gcd of depositBNs as BigInt
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
        const gcdArray = (arr: bigint[]) => arr.reduce((acc, v) => bigGcd(acc, v), arr[0]);
        const gcd = gcdArray(bigints);
        const normalized = bigints.map((v) => v / gcd);
        const human = normalized.map((v, i) => {
          const dec = decimalsList[i] ?? 0;
          const denom = Number(BigInt(10) ** BigInt(dec));
          const val = Number(v) / denom;
          return `${val} ${tokens.find((t) => t.mint === mints[i].toBase58())?.symbol ?? ''}`.trim();
        });
        const msg = `You're creating a new composite. 1 composite = ${human.join(' + ')}.`;
        setConfirmModalText(msg);
        // show modal and await user's decision
        const userOk = await new Promise<boolean>((res) => {
          confirmResolveRef.current = res;
          setConfirmModalOpen(true);
        });
        setConfirmModalOpen(false);
        confirmResolveRef.current = null;
        if (!userOk) return;
      }

      // Client-side validation: ensure each deposit is a multiple of per-unit and all k_i are equal
      const validateDeposits = (deposits: anchor.BN[], perUnits: anchor.BN[]) => {
        if (deposits.length !== perUnits.length) return { ok: false, reason: "length mismatch" };
        let k: bigint | null = null;
        for (let i = 0; i < deposits.length; i++) {
          const amount = BigInt(deposits[i].toString());
          const per = BigInt(perUnits[i].toString());
          if (per <= BigInt(0)) return { ok: false, reason: `invalid per-unit for index ${i}` };
          if (amount <= BigInt(0)) return { ok: false, reason: `zero amount for index ${i}` };
          if (amount % per !== BigInt(0)) return { ok: false, reason: `token ${i} amount not multiple of per-unit` };
          const k_i = amount / per;
          if (k === null) k = k_i;
          else if (k !== k_i) return { ok: false, reason: `ratio mismatch: token ${i} gives k=${k_i} vs expected ${k}` };
        }
        return { ok: true, k: k ?? BigInt(0) };
      };

      const v = validateDeposits(depositBNs, perUnitForCall);
      if (!v.ok) {
        toast.error(`Validation failed: ${v.reason}`);
        return;
      }

      // ensure program account exists on-chain to provide better error message
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
              ...mints.map((m) => ({ pubkey: m, isSigner: false, isWritable: false })),
              ...vaults.map((v) => ({ pubkey: v, isSigner: false, isWritable: true })),
              ...userAtas.map((u) => ({ pubkey: u, isSigner: false, isWritable: true })),
            ])
            .signers([compositeMintKeypair]);

          const txSig = await method.rpc();
          console.log("depositAndMintWithInit tx:", txSig);
          toast.success("Deposit + mint submitted");
        } catch (err: any) {
          // If this is a SendTransactionError from web3/anchor, try to extract simulation logs
          console.error("depositAndMintWithInit error:", err);
          try {
            if (typeof err.getLogs === "function") {
              const logs = await err.getLogs();
              console.error("Simulation logs:", logs);
              toast.error("Transaction simulation failed — see console logs for details");
            } else if (err instanceof Error && (err as any).logs) {
              console.error("Error logs:", (err as any).logs);
              toast.error("Transaction failed — see console logs for details");
            } else {
              toast.error("Deposit failed — see console for details");
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

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="flex items-center gap-2">
        {/* Keep a consistent look with the wallet button by reusing the WalletMultiButton styles */}
        <button
          onClick={toggleOpen}
          className="wallet-adapter-button wallet-adapter-dropdown inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#7C3AED] to-[#06B6D4] px-4 py-2 text-sm font-medium text-white shadow-lg hover:opacity-95"
        >
          Deposit & Mint
        </button>
  {/* Wallet connect is expected to be displayed globally (header); avoid duplicating it here */}
      </div>
      {/* Confirmation modal (non-blocking) */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-50 w-96 rounded-lg bg-gray-800 p-4">
            <div className="text-sm font-semibold mb-2">Confirm composite creation</div>
            <div className="text-sm text-white/80 mb-4">{confirmModalText}</div>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-md bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/8"
                onClick={() => {
                  if (confirmResolveRef.current) confirmResolveRef.current(false);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                onClick={() => {
                  if (confirmResolveRef.current) confirmResolveRef.current(true);
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-sm rounded-xl bg-gray-900/90 ring-1 ring-white/10 p-4 shadow-2xl z-50">
          <div className="flex items-center justify-between pb-2 border-b border-white/5">
            <div className="text-sm font-semibold">Select assets</div>
            <button onClick={() => setOpen(false)} className="text-xs text-white/60 hover:text-white">
              Close
            </button>
          </div>

          <div className="mt-3 max-h-64 overflow-auto space-y-2 pr-2">
            {loading ? (
              <div className="p-2 text-sm text-white/70">Loading...</div>
            ) : (
              tokens.map((t) => (
                <div
                  key={t.address}
                  className="flex items-center gap-3 rounded-md p-2 hover:bg-white/2"
                >
                  <input
                    aria-label={`select-${t.address}`}
                    type="checkbox"
                    checked={t.address in selections}
                    onChange={() => onToggleSelect(t)}
                    disabled={t.address === "SOL"}
                    className="h-4 w-4 text-emerald-400 rounded"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium truncate text-white">{t.symbol || t.name || t.mint || t.address}</div>
                      <div className="text-[11px] text-white/60 truncate">{t.address === "SOL" ? `${t.amount} SOL` : `${t.amount ?? 0}`}</div>
                    </div>
                    <div className="text-[11px] text-white/40 truncate">{t.mint ?? t.address}</div>
                  </div>

                  <div className="w-28 text-right">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => {
                        if (!(t.address in selections)) {
                          setSelections((prev) => ({ ...prev, [t.address]: "" }));
                        }
                      }}
                      className="w-full rounded bg-gray-800/60 border border-white/6 px-2 py-1 text-right text-sm text-white"
                      value={selections[t.address] ?? ""}
                      onChange={(e) => onChangeAmount(t, e.target.value)}
                      placeholder="0"
                    />
                    <div className="text-[10px] text-white/40">/ {t.amount ?? 0}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              className="rounded-md bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/8"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
              onClick={async () => {
                setProcessing(true);
                try {
                  await handleConfirmDeposit();
                } finally {
                  setProcessing(false);
                }
              }}
              disabled={processing}
            >
              {processing ? "Submitting..." : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
                