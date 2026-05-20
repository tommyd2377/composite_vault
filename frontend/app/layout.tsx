import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

import { Geist, Geist_Mono } from "next/font/google";

import type { Metadata } from "next";
import { SolanaProvider } from "@/components/counter/provider/Solana";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Blndr",
  description:
    "Create and redeem basket-backed composite tokens on Solana devnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-[#02040a] text-slate-100 antialiased`}
      >
        <SolanaProvider>
          {children}
          <Toaster
            position="bottom-right"
            theme="dark"
            closeButton
            richColors={false}
            toastOptions={{
              style: {
                background: "#020617",
                color: "white",
                border: "1px solid rgba(51, 65, 85, 0.85)",
                borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
                boxShadow: "0 18px 60px rgba(0, 0, 0, 0.38)",
              },
              className: "toast-container",
            }}
          />
        </SolanaProvider>
      </body>
    </html>
  );
}
