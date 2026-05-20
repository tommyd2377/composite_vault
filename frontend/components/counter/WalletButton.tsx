"use client";

import dynamic from "next/dynamic";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-11 w-[174px] animate-pulse items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3">
        <div className="h-6 w-6 rounded-full bg-purple-400/30" />
        <div className="h-4 w-24 rounded-sm bg-white/10" />
      </div>
    ),
  }
);

export function WalletButton({ className = "" }: { className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`inline-flex ${className}`}>
            <WalletMultiButton />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Solana devnet wallet</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
