/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useProgram } from "./hooks/useProgram";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

type TokenInfo = {
  address: string;
  mint?: string;
  amount: string | number | null;
  decimals?: number;
  name?: string;
  symbol?: string;
};

export function SimpleLogButton() {
  const { publicKey, connection } = useProgram();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [tokenMap, setTokenMap] = useState<Record<string, { name?: string; symbol?: string }>>({});
  const [selections, setSelections] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
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
      setSol(solBalance);

      const resp = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

  const parsed = resp.value.map(({ pubkey, account }) => {
        // parsed data shape from RPC
        const parsedData = (account.data as any).parsed;
        const info = parsedData?.info;
        const tokenAmount = info?.tokenAmount;
        // compute ui amount as number where possible
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

      // include SOL as first asset
      const solEntry: TokenInfo = {
        address: "SOL",
        mint: "SOL",
        amount: solBalance,
        decimals: 9,
      };

  // fetch token list once to map mint -> name/symbol (use CDN)
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
            // apply to parsed
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

      // For any tokens still missing symbol/name, try on-chain Metaplex metadata
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
                  // parse borsh-like Data: skip key(1) + updateAuthority(32) + mint(32)
                  const buf = info.data;
                  let offset = 1 + 32 + 32;
                  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                  const nameLen = dv.getUint32(offset, true); // little-endian
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
    // Open -> fetch assets if not already fetched
    if (!open) {
      await fetchAssets();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const onToggleSelect = (t: TokenInfo) => {
    setSelections((prev) => {
      const copy = { ...prev };
      // check key presence (handles empty-string values)
      if (t.address in copy) {
        delete copy[t.address];
      } else {
        // default selected amount is empty string (user must input)
        copy[t.address] = "";
      }
      return copy;
    });
  };

  const onChangeAmount = (t: TokenInfo, raw: string) => {
    // allow only numbers and dot
    const filtered = raw.replace(/[^0-9.]/g, "");
    // clamp to available
    const available = Number(t.amount ?? 0);
    let valueNum = Number(filtered || 0);
    if (isNaN(valueNum)) valueNum = 0;
    if (valueNum > available) valueNum = available;

    setSelections((prev) => {
      const copy = { ...prev };
      // always set entry when user types so checkbox appears checked
      copy[t.address] = valueNum === 0 ? "" : String(valueNum);
      return copy;
    });
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      <Button onClick={toggleOpen} className="w-full bg-green-600 hover:bg-green-700 text-white h-10 text-sm">
        {open ? "Close Assets" : "Show Wallet Assets"}
      </Button>

      {open && (
        <div className="absolute z-50 mt-2 w-full bg-gray-800 rounded-md shadow-lg border border-gray-700 max-h-60 overflow-auto">
          <div className="p-2 text-xs text-gray-300">SOL: {loading ? "..." : sol ?? "-"}</div>
          <div className="border-t border-gray-700" />
          {loading && <div className="p-2 text-sm text-gray-400">Loading...</div>}
          {!loading && tokens.length === 0 && <div className="p-2 text-sm text-gray-400">No token accounts found</div>}
          <ul>
            {tokens.map((t) => (
              <li key={t.address} className="border-t border-gray-700">
                <div className="flex items-center justify-between p-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      // consider a token selected if it has an entry in the selections map
                      checked={selections[t.address] !== undefined}
                      onChange={() => onToggleSelect(t)}
                      className="w-4 h-4"
                    />
                    <div className="truncate text-sm text-gray-200" style={{minWidth: 120}}>
                      {t.symbol ? `${t.symbol}` : t.name ? `${t.name}` : (t.mint ?? t.address)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={selections[t.address] ?? ""}
                      onChange={(e) => onChangeAmount(t, e.target.value)}
                      placeholder="0"
                      className="w-20 bg-gray-900 border border-gray-700 text-right text-sm text-gray-200 px-2 py-1 rounded"
                    />
                    <div className="text-xs text-gray-400">/ {String(t.amount)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
 
