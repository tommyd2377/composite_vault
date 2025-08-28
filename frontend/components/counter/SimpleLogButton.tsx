"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useProgram } from "./hooks/useProgram";

export function SimpleLogButton() {
  const { publicKey, program } = useProgram();

  const handleDeposit = async () => {
  if (!publicKey) return toast.error("Connect your wallet first");
  if (!program) return toast.error("Program not loaded");
  console.log("Deposit button clicked (simplified): wallet and program present", {
    publicKey: publicKey.toBase58(),
    programId: program.programId.toBase58(),
  });
  };

  return (
    <Button onClick={handleDeposit} className="w-full bg-green-600 hover:bg-green-700 text-white h-10 text-sm">Deposit & Mint</Button>
  );
}
 
