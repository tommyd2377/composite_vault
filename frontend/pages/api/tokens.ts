import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getMint } from "@solana/spl-token";

type TokenRow = {
  configPda: string;
  compositeMint: string;
  numAssets: number;
  decimals?: number;
  supply?: string;
};

const CACHE_TTL = Number(process.env.TOKENS_CACHE_TTL_MS || 30_000);
let cache: { ts: number; data: TokenRow[] } | null = null;

function readIdl() {
  // Try a few likely locations for the IDL. process.cwd() will be the
  // frontend folder during Next dev, so prefer <cwd>/anchor-idl first.
  const candidates = [
    path.join(process.cwd(), "anchor-idl", "composite_vault.json"),
    path.join(process.cwd(), "frontend", "anchor-idl", "composite_vault.json"),
    path.join(process.cwd(), "..", "frontend", "anchor-idl", "composite_vault.json"),
  ];

  for (const idlPath of candidates) {
    if (fs.existsSync(idlPath)) {
      const raw = fs.readFileSync(idlPath, "utf8");
      return JSON.parse(raw) as unknown;
    }
  }

  throw new Error(`IDL not found; looked in: ${candidates.join(", ")}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return res.status(200).json({ ok: true, source: "cache", tokens: cache.data });
    }

  const idl = readIdl();
  // narrow idl to expected shape
  const idlObj = idl as { address?: string; accounts?: unknown };
  if (!idlObj.address) throw new Error("IDL missing address");
  const programId = new PublicKey(idlObj.address);

    const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpc, { commitment: "confirmed" });

    // find the CompositeConfig discriminator from IDL.accounts
    const accountsArray = Array.isArray(idlObj.accounts) ? (idlObj.accounts as unknown[]) : [];
    const accountDef = accountsArray.find((a) => {
      const acct = a as { name?: string; discriminator?: number[] };
      return acct.name === "CompositeConfig" || acct.name === "compositeConfig" || acct.name === "Compositeconfig";
    }) as { name?: string; discriminator?: number[] } | undefined;
    if (!accountDef) throw new Error("CompositeConfig account definition not found in IDL");
  const discriminator = accountDef.discriminator;
  if (!discriminator || discriminator.length === 0) throw new Error("Account discriminator missing in IDL");

    // filter program accounts by discriminator prefix
  const memcmpBytes = bs58.encode(Buffer.from(discriminator));
    const programAccounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: memcmpBytes,
          },
        },
      ],
    });

    const rows: TokenRow[] = [];

    for (const pa of programAccounts) {
      try {
        const data = pa.account.data as Buffer | Uint8Array | string;
        // Anchor account layout: 8b discriminator, then fields
        // offsets (bytes):
        // 0-7: discriminator
        // 8-39: authority (32)
        // 40-71: composite_mint (32)
        // 72-103: mint_authority (32)
        // 104: num_assets (u8)
        // 105-360: mints (32 * 8)
        // 361-424: amounts_per_unit (u64 * 8)
        // 425: bump_config (u8)
        // 426: bump_mint_auth (u8)

        let buf: Buffer;
        if (typeof data === "string") {
          buf = Buffer.from(data, "base64");
        } else if (Buffer.isBuffer(data)) {
          buf = data as Buffer;
        } else {
          // Uint8Array
          buf = Buffer.from(data as Uint8Array);
        }
        const compositeMintBuf = buf.slice(40, 72);
        const numAssets = buf.readUInt8(104);
        const compositeMint = new PublicKey(compositeMintBuf);

        const row: TokenRow = {
          configPda: pa.pubkey.toBase58(),
          compositeMint: compositeMint.toBase58(),
          numAssets: numAssets,
        };

        // try to enrich with mint info
        try {
          const mintInfo = await getMint(connection, compositeMint);
          row.decimals = mintInfo.decimals;
          row.supply = mintInfo.supply.toString();
        } catch (e) {
          // ignore per-mint failures
          console.debug("getMint failed for", compositeMint.toBase58(), String(e));
        }

        rows.push(row);
      } catch (e) {
        console.warn("failed parsing program account", pa.pubkey.toBase58(), String(e));
      }
    }

    // sort by supply (descending) when available
    rows.sort((a, b) => {
      try {
        const sa = BigInt(a.supply ?? "0");
        const sb = BigInt(b.supply ?? "0");
        if (sa > sb) return -1;
        if (sa < sb) return 1;
        return a.compositeMint.localeCompare(b.compositeMint);
      } catch {
        return a.compositeMint.localeCompare(b.compositeMint);
      }
    });

    cache = { ts: Date.now(), data: rows };
    return res.status(200).json({ ok: true, source: "rpc", tokens: rows });
  } catch (e: unknown) {
    console.error("/api/tokens error", String(e));
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
