import { CompositeLeaderboard } from "@/components/TokenLeaderboard";
import { CreateBlendCard } from "@/components/counter/CounterCard";
import { WalletButton } from "@/components/counter/WalletButton";
import {
  faGithub,
  faLinkedin,
  faTelegram,
  faTwitter,
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const featureCards = [
  {
    title: "Basket-backed",
    copy: "Composite tokens are minted from underlying SPL assets deposited into program vaults.",
  },
  {
    title: "Redeemable",
    copy: "Burn the composite token to withdraw the basket backing when your wallet holds supply.",
  },
  {
    title: "Devnet prototype",
    copy: "Built for public testing on Solana devnet with clear network status throughout the app.",
  },
];

const steps = ["Select assets", "Mint composite", "Track or redeem"];

const socialLinks = [
  { href: "https://x.com/thomasfdevito", label: "X", icon: faTwitter },
  { href: "https://t.me/doubting_tom", label: "Telegram", icon: faTelegram },
  { href: "https://www.linkedin.com/in/tdevito", label: "LinkedIn", icon: faLinkedin },
  { href: "https://github.com/tommyd2377", label: "GitHub", icon: faGithub },
];

export default function Home() {
  return (
    <div className="blndr-page">
      <div className="blndr-atmosphere relative min-h-screen">
        <div className="blndr-grid pointer-events-none absolute inset-0" />
        <div className="relative z-10">
          <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#02040a]/88 backdrop-blur-xl">
            <div className="blndr-container flex min-h-20 items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#14F195]/45 bg-slate-950 shadow-[0_0_28px_rgba(20,241,149,0.16)]">
                  <span className="blndr-gradient-text text-lg font-black tracking-normal">
                    B
                  </span>
                </div>
                <div>
                  <div className="text-lg font-semibold tracking-normal text-white">
                    Blndr
                  </div>
                  <div className="hidden text-xs text-slate-400 sm:block">
                    Composite tokens on Solana
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="blndr-pill-accent">Devnet</span>
                <div className="hidden sm:block">
                  <WalletButton />
                </div>
              </div>
            </div>
          </header>

          <main className="blndr-container py-8 sm:py-10 lg:py-12">
            <section className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
              <div className="flex flex-col gap-6">
                <div className="max-w-3xl">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-[#9945FF]/35 bg-[#9945FF]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-purple-100">
                    Internet capital markets, composed
                  </div>
                  <h1 className="text-balance text-5xl font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl">
                    Create basket-backed{" "}
                    <span className="blndr-gradient-text">Solana tokens</span>{" "}
                    from the assets in your wallet.
                  </h1>
                  <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                    Deposit assets in fixed ratios, mint a composite token, and
                    redeem it later for the underlying basket.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {featureCards.map((feature) => (
                    <div key={feature.title} className="blndr-surface-soft p-4">
                      <div className="mb-2 text-sm font-semibold text-white">
                        {feature.title}
                      </div>
                      <p className="text-sm leading-6 text-slate-400">
                        {feature.copy}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="blndr-surface-soft p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    How it works
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {steps.map((step, index) => (
                      <div key={step} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-xs font-semibold text-emerald-100">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium text-slate-200">
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              <CreateBlendCard />
            </section>

            <section id="leaderboard" className="mt-8 lg:mt-10">
              <CompositeLeaderboard />
            </section>
          </main>

          <footer className="blndr-container border-t border-slate-800/80 py-8">
            <div className="flex flex-col gap-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-300">
                  Presented by{" "}
                  <span className="blndr-gradient-text">Thomas DeVito</span>
                </p>
                <p className="mt-1">Made with care in NYC.</p>
              </div>
              <div className="flex items-center gap-3">
                {socialLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.label}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-slate-300 transition hover:border-[#00C2FF]/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00C2FF]/40"
                  >
                    <FontAwesomeIcon icon={link.icon} className="h-4 w-4" />
                  </a>
                ))}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
