"use client";

import { Card, CardContent } from "@/components/ui/card";

// Increment/Decrement removed — Composite flow only
import { SimpleLogButton } from "./SimpleLogButton";
import React from "react";
import { WalletButton } from "./WalletButton";

/**
 * CounterCard is the main component for the Counter dApp.
 * It provides a user interface for interacting with a Solana counter program.
 */
export function CounterCard() {
  return (
    <Card className="w-[350px] mx-auto border-gray-800 bg-gray-900/70 backdrop-blur-sm shadow-xl shadow-purple-900/10">
      <CardContent className="flex flex-col items-center py-6 space-y-6">
        <WalletButton />
        <div className="flex flex-col w-full items-center space-y-3">
          <SimpleLogButton />
        </div>
      </CardContent>
    </Card>
  );
}
