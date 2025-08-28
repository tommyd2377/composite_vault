"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";

import { useProgram } from "./hooks/useProgram";

/**
 * CounterDisplay component that displays the current counter value
 * and handles its own data fetching logic.
 */
export function CounterDisplay() {
  // Get program information from the hook
  const { program, counterAddress, connection } = useProgram();

  // Local state
  const [counterValue, setCounterValue] = useState<number | null>(null);
  const [isFetchingCounter, setIsFetchingCounter] = useState(true);

  // Fetch counter account to get the count value
  const fetchCounterValue = useCallback(async () => {
    if (!connection || !program) return;

    try {
      setIsFetchingCounter(true);

      // Preferred: use Anchor's generated account fetch if available
      const accountFetch = (program as any)?.account?.counter?.fetch;
      if (typeof accountFetch === "function") {
        const counterAccount = await accountFetch.call((program as any).account.counter, counterAddress as any);
        setCounterValue(Number(counterAccount.count));
        return;
      }

      // Fallback: fetch raw account data and decode with the program coder
  const info = await connection.getAccountInfo(counterAddress as any, "confirmed");
      if (!info?.data) {
        setCounterValue(null);
        return;
      }

      const decoded = (program as any).coder.accounts.decode("counter", info.data as Buffer);
      setCounterValue(Number(decoded.count));
    } catch (err) {
      console.error("Error fetching counter value:", err);
      setCounterValue(null);
    } finally {
      setIsFetchingCounter(false);
    }
  }, [connection, program, counterAddress]);

  // Initial fetch and on connection change
  useEffect(() => {
    if (connection) {
      fetchCounterValue();
    }
  }, [connection, fetchCounterValue]);

  // Set up WebSocket subscription to listen for account changes
  useEffect(() => {
    if (!connection || !program) return;

    try {
      // Subscribe to account changes
      const subscriptionId = connection.onAccountChange(
        counterAddress as any,
        (accountInfo) => {
          const decoded = (program as any).coder.accounts.decode(
            "counter",
            accountInfo.data
          );
          console.log("Decoded counter value:", decoded);
          setCounterValue(Number(decoded.count));
        },
        {
          commitment: "confirmed",
          encoding: "base64",
        }
      );

      // Clean up subscription when component unmounts
      return () => {
        console.log("Unsubscribing from counter account");
        connection.removeAccountChangeListener(subscriptionId);
      };
    } catch (err) {
      console.error("Error setting up account subscription:", err);
      return () => {};
    }
  }, [connection, counterAddress, program]);

  return (
    <div className="text-center w-full px-5">
      <p className="text-sm text-muted-foreground mb-2">Current Count:</p>
      <div className="h-14 flex items-center justify-center">
        {isFetchingCounter ? (
          <div className="h-7 w-7 rounded-full border-3 border-purple-400/30 border-t-purple-400 animate-spin" />
        ) : (
          <p className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 text-transparent bg-clip-text">
            {counterValue}
          </p>
        )}
      </div>
    </div>
  );
}
