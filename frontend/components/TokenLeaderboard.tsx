"use client";
import React, { useEffect, useState } from "react";

type TokenRow = {
  configPda: string;
  compositeMint: string;
  numAssets: number;
  decimals?: number;
  supply?: string;
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
        if (mounted) setData(json);
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

  const tokens: TokenRow[] = data?.tokens || [];

  return (
    <div className="bg-gray-900/80 rounded-lg p-4 text-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Composite Leaderboard</h3>
        <div className="text-xs text-white/60">{isLoading ? "Loading…" : `${tokens.length} entries`}</div>
      </div>

      {error && <div className="text-red-400 text-sm">Failed to load tokens</div>}

      <ul className="divide-y divide-white/5">
        {tokens.slice(0, limit).map((t) => (
          <li key={t.compositeMint} className="py-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium truncate">{t.compositeMint}</div>
              <div className="text-xs text-white/60">config: {t.configPda} • assets: {t.numAssets}</div>
            </div>
            <div className="text-sm font-mono text-right">
              <div>{t.supply ?? "-"}</div>
              <div className="text-xs text-white/60">dec {t.decimals ?? "-"}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TokenLeaderboard;
