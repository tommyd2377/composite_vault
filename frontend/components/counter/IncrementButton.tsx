"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from "react";

import { Button } from "@/components/ui/button";

import { useProgram } from "./hooks/useProgram";
import { useTransactionToast } from "./hooks/useTransactionToast";

/**
 * IncrementButton component that handles its own transaction logic
 * for incrementing the counter.
 */
export function IncrementButton() {
  // Get program and wallet information from the hook
  const { program, publicKey, connected } = useProgram();

  // Local state
  const [isLoading, setIsLoading] = useState(false);
  const [transactionSignature, setTransactionSignature] = useState<
    string | null
  >(null);

  // Use transaction toast hook
  useTransactionToast({ transactionSignature });

  // Handle increment button click: log and optionally call increment RPC if program loaded
  const handleIncrement = async () => {
    if (!publicKey) return;
    setIsLoading(true);
    try {
      console.log("Increment button clicked", { publicKey: publicKey.toBase58(), program: program?.programId?.toBase58?.() });
      if (program) {
        try {
          const txSignature = await (program as any).methods.increment().accounts({ user: publicKey }).rpc();
          setTransactionSignature(txSignature);
        } catch (rpcErr) {
          console.warn("Program increment RPC failed (logged only):", rpcErr);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleIncrement}
      disabled={isLoading || !connected}
      className="w-[85%] bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white h-11 text-base font-medium"
    >
      {isLoading ? (
        <div className="flex items-center justify-center">
          <div className="h-5 w-5 rounded-full border-2 border-purple-200/50 border-t-purple-200 animate-spin mr-2"></div>
          <span>Processing...</span>
        </div>
      ) : (
        "Increment Counter"
      )}
    </Button>
  );
}
