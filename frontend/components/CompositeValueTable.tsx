"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { CompositeValue } from "@/lib/compositeValue";
import { fetchCompositeValues } from "@/lib/compositeValue";

type ComponentState = {
  data: CompositeValue[];
  loading: boolean;
  error: string | null;
};

export function CompositeValueTable() {
  const { connection } = useConnection();
  const [{ data, loading, error }, setState] = useState<ComponentState>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!connection) return;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const values = await fetchCompositeValues(connection);
        if (!cancelled) {
          setState({ data: values, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ data: [], loading: false, error: (err as Error).message });
        }
      }
    };

    run();
    const interval = setInterval(run, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  const rows = useMemo(() => data, [data]);

  return (
    <div className="bg-gray-900/80 rounded-lg p-4 text-white mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Composite USD Values</h3>
        {loading && <span className="text-xs text-white/60">Refreshing…</span>}
      </div>

      {error && (
        <div className="text-xs text-red-400 mb-3">Failed to load composite values: {error}</div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-sm text-white/60">No composites found.</div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-white/60 border-b border-white/10">
                <th className="py-2 pr-4">Composite Mint</th>
                <th className="py-2 pr-4">Assets</th>
                <th className="py-2 text-right">Total USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.compositeMint} className="border-b border-white/5">
                  <td className="py-3 pr-4 align-top font-mono text-xs">
                    {row.compositeMint}
                  </td>
                  <td className="py-3 pr-4 align-top">
                    <div className="space-y-1">
                      {row.assets.map((asset) => (
                        <div key={`${row.compositeMint}-${asset.mint}`} className="flex justify-between gap-3">
                          <span className="text-xs font-medium">
                            {asset.symbol} <span className="text-white/50">({asset.balance.toFixed(4)})</span>
                          </span>
                          <span className="text-xs text-white/70">
                            ${asset.price.toFixed(4)} → ${asset.usdValue.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 text-right font-semibold">
                    ${row.totalValueUSD.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default CompositeValueTable;
