import { Connection, PublicKey } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import idl from "@/anchor-idl/composite_vault.json";

export type CompositeAssetValue = {
  mint: string;
  symbol: string;
  balance: number;
  price: number;
  usdValue: number;
};

export type CompositeValue = {
  compositeMint: string;
  assets: CompositeAssetValue[];
  totalValueUSD: number;
};

type TokenMetadata = { name?: string; symbol?: string };

type TokenList = Record<string, TokenMetadata>;

const PRICE_TTL_MS = 60_000;
const priceCache = new Map<string, { price: number; ts: number }>();
let tokenListPromise: Promise<TokenList> | null = null;
const mintDecimalsCache = new Map<string, number>();

const PROGRAM_ID = new PublicKey((idl as { address: string }).address);

async function loadTokenList(): Promise<TokenList> {
  if (!tokenListPromise) {
    tokenListPromise = fetch(
      "https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json"
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Token list fetch failed: ${res.status}`);
        const json = await res.json();
        const map: TokenList = {};
        for (const entry of json.tokens ?? []) {
          if (entry.address) {
            map[entry.address] = { name: entry.name, symbol: entry.symbol };
          }
        }
        return map;
      })
      .catch((err) => {
        console.warn("Failed loading token list", err);
        return {} as TokenList;
      });
  }
  return tokenListPromise;
}

async function getMintDecimals(connection: Connection, mint: string): Promise<number> {
  const cached = mintDecimalsCache.get(mint);
  if (cached !== undefined) return cached;
  const mintPub = new PublicKey(mint);
  const mintInfo = await getMint(connection, mintPub);
  mintDecimalsCache.set(mint, mintInfo.decimals);
  return mintInfo.decimals;
}

async function fetchPricesForMints(mints: string[]): Promise<Map<string, number>> {
  const now = Date.now();
  const result = new Map<string, number>();
  const toFetch: string[] = [];

  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now - cached.ts < PRICE_TTL_MS) {
      result.set(mint, cached.price);
    } else if (!toFetch.includes(mint)) {
      toFetch.push(mint);
    }
  }

  if (toFetch.length) {
    const url = `https://price.jup.ag/v4/price?ids=${toFetch.join(",")}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const data = json?.data ?? {};
        for (const mint of toFetch) {
          const price = Number(data?.[mint]?.price ?? NaN);
          if (Number.isFinite(price)) {
            priceCache.set(mint, { price, ts: now });
            result.set(mint, price);
          }
        }
      } else {
        console.warn("Price fetch failed", res.status, await res.text());
      }
    } catch (err) {
      console.warn("Price fetch error", err);
    }
  }

  return result;
}

function parseCompositeConfigAccount(data: Buffer) {
  const numAssets = data.readUInt8(104);
  const mintAuth = new PublicKey(data.slice(72, 104));
  const mints: PublicKey[] = [];
  let cursor = 105;
  for (let i = 0; i < numAssets; i += 1) {
    const mintBytes = data.slice(cursor, cursor + 32);
    mints.push(new PublicKey(mintBytes));
    cursor += 32;
  }
  return { numAssets, mintAuth, mints };
}

export async function fetchCompositeValues(connection: Connection): Promise<CompositeValue[]> {
  const tokenMap = await loadTokenList();
  const compositeResponse = await fetch("/api/tokens");
  if (!compositeResponse.ok) {
    throw new Error(`Failed to load composite tokens: ${compositeResponse.status}`);
  }
  const tokenJson = await compositeResponse.json();
  const tokens: Array<{ compositeMint: string }> = tokenJson?.tokens ?? [];

  if (!tokens.length) return [];

  const composites: CompositeValue[] = [];
  const priceMints = new Set<string>();

  for (const token of tokens) {
    const compositeMint = new PublicKey(token.compositeMint);
    const [configPda] = PublicKey.findProgramAddressSync([
      Buffer.from("config"),
      compositeMint.toBuffer(),
    ], PROGRAM_ID);

    const configInfo = await connection.getAccountInfo(configPda);
    if (!configInfo) {
      console.warn("Config account missing for", compositeMint.toBase58());
      continue;
    }

    const { mints, mintAuth } = parseCompositeConfigAccount(configInfo.data);
    if (!mints.length) continue;

    const vaultPubkeys = await Promise.all(
      mints.map((mint) => getAssociatedTokenAddressCached(mint, mintAuth, true))
    );
    const vaultInfos = await connection.getMultipleAccountsInfo(vaultPubkeys);

    const assetValues: CompositeAssetValue[] = [];
    for (let i = 0; i < mints.length; i += 1) {
      const mint = mints[i];
      const vaultInfo = vaultInfos[i];
      if (!vaultInfo || vaultInfo.data.length === 0) continue;

      const decoded = AccountLayout.decode(vaultInfo.data);
      const amountField = decoded.amount as unknown;

      let rawAmount: bigint;
      if (typeof amountField === "bigint") {
        rawAmount = amountField;
      } else if (Buffer.isBuffer(amountField)) {
        rawAmount = amountField.readBigUInt64LE(0);
      } else if (amountField instanceof Uint8Array) {
        rawAmount = Buffer.from(amountField).readBigUInt64LE(0);
      } else {
        throw new Error("Unsupported amount field type in token account");
      }
      const mintStr = mint.toBase58();
      const decimals = await getMintDecimals(connection, mintStr);
      const balance = Number(rawAmount) / 10 ** decimals;
      priceMints.add(mintStr);

      assetValues.push({
        mint: mintStr,
        symbol: tokenMap[mintStr]?.symbol ?? mintStr.slice(0, 6),
        balance,
        price: 0,
        usdValue: 0,
      });
    }

    composites.push({
      compositeMint: compositeMint.toBase58(),
      assets: assetValues,
      totalValueUSD: 0,
    });
  }

  const prices = await fetchPricesForMints(Array.from(priceMints));

  for (const composite of composites) {
    let total = 0;
    for (const asset of composite.assets) {
      const price = prices.get(asset.mint) ?? 0;
      const usdValue = asset.balance * price;
      asset.price = price;
      asset.usdValue = usdValue;
      total += usdValue;
    }
    composite.totalValueUSD = total;
  }

  return composites;
}

const ataCache = new Map<string, PublicKey>();
async function getAssociatedTokenAddressCached(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve: boolean
): Promise<PublicKey> {
  const cacheKey = `${mint.toBase58()}-${owner.toBase58()}`;
  const cached = ataCache.get(cacheKey);
  if (cached) return cached;
  const ata = await getAssociatedTokenAddress(mint, owner, allowOwnerOffCurve);
  ataCache.set(cacheKey, ata);
  return ata;
}
