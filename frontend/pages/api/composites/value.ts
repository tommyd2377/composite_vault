import type { NextApiRequest, NextApiResponse } from "next";
import { Connection, PublicKey } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import idl from "@/anchor-idl/composite_vault.json";

const CACHE_TTL_MS = Number(process.env.COMPOSITE_VALUE_CACHE_TTL_MS || 60_000);
const priceCache = new Map<string, { ts: number; price: number }>();
let responseCache: { ts: number; payload: unknown } | null = null;
const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
const PRICE_ENDPOINT = "https://api.dexscreener.com/latest/dex/tokens";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const now = Date.now();
    if (responseCache && now - responseCache.ts < CACHE_TTL_MS) {
      return res.status(200).json(responseCache.payload);
    }

    const deploymentUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
    const headerHost = req.headers.host ?? null;
    const derivedHost = headerHost
      ? headerHost.includes("localhost")
        ? `http://${headerHost}`
        : `https://${headerHost}`
      : "http://localhost:3000";
    const baseUrl = process.env.API_BASE_URL || deploymentUrl || derivedHost;

    console.info("/api/composites/value fetching tokens", {
      baseUrl,
      deploymentUrl,
      headerHost,
    });

    const apiTokensRes = await fetch(`${baseUrl}/api/tokens`);
    const tokensBody = await apiTokensRes.text();
    if (!apiTokensRes.ok) {
      console.error("/api/composites/value tokens fetch failed", {
        status: apiTokensRes.status,
        baseUrl,
        snippet: tokensBody.slice(0, 500),
      });
      throw new Error(`tokens api ${apiTokensRes.status}`);
    }
    let apiTokens: unknown;
    try {
      apiTokens = JSON.parse(tokensBody) as unknown;
    } catch (jsonErr) {
      console.error("/api/composites/value failed parsing /api/tokens response", {
        baseUrl,
        tokensBody,
        jsonErr,
      });
      throw new Error("tokens api invalid json");
    }
    const tokensData = apiTokens as { tokens?: Array<{ compositeMint: string }> } | null;
    const tokens: Array<{ compositeMint: string }> = tokensData?.tokens ?? [];

    const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpc, { commitment: "confirmed" });

    const values = await Promise.all(
      tokens.map(async (t) => fetchCompositeValue(connection, t.compositeMint))
    );

    responseCache = { ts: now, payload: values };
    return res.status(200).json(values);
  } catch (err) {
    console.error("/api/composites/value error", {
      err,
      env: {
        API_BASE_URL: process.env.API_BASE_URL,
        VERCEL_URL: process.env.VERCEL_URL,
        SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
      },
    });
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

async function fetchCompositeValue(connection: Connection, compositeMintStr: string) {
  try {
    const compositeMint = new PublicKey(compositeMintStr);
    const [configPda] = PublicKey.findProgramAddressSync([
      Buffer.from("config"),
      compositeMint.toBuffer(),
    ], PROGRAM_ID);
    const configInfo = await connection.getAccountInfo(configPda);
    if (!configInfo) {
      return { compositeMint: compositeMintStr, assets: [], totalValueUSD: 0 };
    }

    const numAssets = configInfo.data.readUInt8(104);
    const mintAuth = new PublicKey(configInfo.data.slice(72, 104));

    const mints: PublicKey[] = [];
    let offset = 105;
    for (let i = 0; i < numAssets; i += 1) {
      mints.push(new PublicKey(configInfo.data.slice(offset, offset + 32)));
      offset += 32;
    }

    const vaultAddresses = await Promise.all(
      mints.map((mint) => getAssociatedTokenAddress(mint, mintAuth, true))
    );
    const vaultInfos = await connection.getMultipleAccountsInfo(vaultAddresses);

    const priceMints = new Set<string>();
    const assets: Array<{ mint: string; balance: number }> = [];

    for (let i = 0; i < mints.length; i += 1) {
      const mint = mints[i];
    const info = vaultInfos[i];
    if (!info || info.data.length === 0) continue;
    const decoded = AccountLayout.decode(info.data);
    const rawAmount = readAmount(decoded.amount);
      const mintStr = mint.toBase58();
      const decimals = await getMintDecimals(connection, mintStr);
      const balance = Number(rawAmount) / 10 ** decimals;
      if (!Number.isFinite(balance) || balance <= 0) {
        continue;
      }
      priceMints.add(mintStr);
      assets.push({ mint: mintStr, balance });
    }

    const prices = await fetchPrices(Array.from(priceMints));
    let totalValueUSD = 0;
    const enriched = assets.map((asset) => {
      const price = prices.get(asset.mint) ?? 0;
      if (!(prices.has(asset.mint))) {
        console.warn("Price missing", { compositeMint: compositeMintStr, mint: asset.mint });
      }
      const usdValue = price * asset.balance;
      totalValueUSD += usdValue;
      return {
        mint: asset.mint,
        balance: asset.balance,
        price,
        usdValue,
      };
    });

    return { compositeMint: compositeMintStr, assets: enriched, totalValueUSD };
  } catch (err) {
    console.warn("fetchCompositeValue failed", { compositeMintStr, err });
    return { compositeMint: compositeMintStr, assets: [], totalValueUSD: 0 };
  }
}

async function getMintDecimals(connection: Connection, mint: string): Promise<number> {
  const mintInfo = await getMint(connection, new PublicKey(mint));
  return mintInfo.decimals;
}

async function fetchPrices(mints: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!mints.length) return result;
  const now = Date.now();
  const need: string[] = [];

  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result.set(mint, cached.price);
    } else {
      need.push(mint);
    }
  }

  if (need.length === 0) return result;

  for (const mint of need) {
    try {
      const price = await fetchDexscreenerPrice(mint);
      if (price !== null) {
        result.set(mint, price);
        priceCache.set(mint, { price, ts: now });
      }
    } catch (err) {
      console.warn("fetchPrices error", { mint, err });
    }
  }

  return result;
}

async function fetchDexscreenerPrice(mint: string): Promise<number | null> {
  const url = `${PRICE_ENDPOINT}/${mint}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`dexscreener ${res.status}`);
  }
  const json = await res.json();
  const pairs: unknown = (json as { pairs?: unknown }).pairs;
  if (!Array.isArray(pairs)) return null;

  let best: { price: number; liquidity: number } | null = null;

  for (const raw of pairs) {
    const pair = raw as {
      baseToken?: { address?: string };
      quoteToken?: { address?: string };
      priceUsd?: unknown;
      priceNative?: unknown;
      liquidity?: { usd?: unknown };
    };
    const liquidity = Number(pair?.liquidity?.usd ?? 0);
    if (!Number.isFinite(liquidity) || liquidity <= 0) continue;

    let price: number | null = null;
    const baseAddress = pair?.baseToken?.address;
    const quoteAddress = pair?.quoteToken?.address;

    if (baseAddress === mint) {
      const priceUsd = Number(pair?.priceUsd ?? 0);
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        price = priceUsd;
      }
    } else if (quoteAddress === mint) {
      const basePriceUsd = Number(pair?.priceUsd ?? 0);
      const priceNative = Number(pair?.priceNative ?? 0);
      if (Number.isFinite(basePriceUsd) && basePriceUsd > 0 && Number.isFinite(priceNative) && priceNative > 0) {
        price = basePriceUsd / priceNative;
      }
    }

    if (price === null) continue;

    if (!best || liquidity > best.liquidity) {
      best = { price, liquidity };
    }
  }

  return best?.price ?? null;
}

function readAmount(amountField: unknown): bigint {
  if (typeof amountField === "bigint") return amountField;
  if (typeof amountField === "number") return BigInt(amountField);

  if (Buffer.isBuffer(amountField)) {
    return amountField.readBigUInt64LE(0);
  }

  if (amountField instanceof Uint8Array) {
    return Buffer.from(amountField).readBigUInt64LE(0);
  }

  if (amountField && typeof (amountField as { toString: () => string }).toString === "function") {
    try {
      return BigInt((amountField as { toString: () => string }).toString());
    } catch (err) {
      console.warn("readAmount failed to parse", err);
    }
  }

  throw new TypeError("Unsupported amount field type");
}
