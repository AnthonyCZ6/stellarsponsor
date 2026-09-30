"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getAddress, isConnected, requestAccess } from "@stellar/freighter-api";
import {
  Check,
  CircleCheck,
  Coins,
  Copy,
  ExternalLink,
  Flag,
  HeartHandshake,
  Info,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Target,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  CONTRACT_ID,
  DEMO_CAMPAIGN,
  IS_DEMO,
  applyDonation,
  donate,
  explorerLink,
  fetchBalance,
  fetchCampaign,
  type Campaign,
  type DonationPhase,
} from "@/lib/stellar";
import { formatXlm, progressPercent, shortenAddress, xlmToStroops } from "@/lib/format";

const FREIGHTER_URL = "https://www.freighter.app/";
const QUICK_AMOUNTS = ["5", "10", "25", "50"];

const PHASE_LABEL: Record<DonationPhase, string> = {
  preparing: "Preparando transacción…",
  signing: "Firma en Freighter…",
  confirming: "Confirmando en la red…",
};

type Notice = { kind: "success" | "error" | "info"; message: string; hash?: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function Home() {
  // ─── Billetera ─────────────────────────────────────────────
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [freighterMissing, setFreighterMissing] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // ─── Campaña ───────────────────────────────────────────────
  const [campaign, setCampaign] = useState<Campaign | null>(IS_DEMO ? DEMO_CAMPAIGN : null);
  const [loadingCampaign, setLoadingCampaign] = useState(!IS_DEMO);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  // ─── Donación ──────────────────────────────────────────────
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<DonationPhase | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  const loadCampaign = useCallback(async (silent = false) => {
    if (IS_DEMO) return;
    if (!silent) setLoadingCampaign(true);
    setCampaignError(null);
    try {
      setCampaign(await fetchCampaign());
    } catch (error) {
      setCampaignError(errorMessage(error));
    } finally {
      if (!silent) setLoadingCampaign(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  const refreshBalance = useCallback(async (account: string | null) => {
    setBalance(IS_DEMO || !account ? null : await fetchBalance(account));
  }, []);

  useEffect(() => {
    void refreshBalance(address);
  }, [address, refreshBalance]);

  // Reconecta en silencio si el usuario ya autorizó esta dApp en Freighter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const connection = await isConnected();
      if (connection.error || !connection.isConnected) return;
      const current = await getAddress();
      if (!cancelled && !current.error && current.address) setAddress(current.address);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function connectWallet() {
    setConnecting(true);
    setWalletError(null);
    setFreighterMissing(false);
    try {
      const connection = await isConnected();
      if (connection.error || !connection.isConnected) {
        setFreighterMissing(true);
        return;
      }

      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message);

      const current = await getAddress();
      if (current.error) throw new Error(current.error.message);

      setAddress(current.address || access.address);
    } catch (error) {
      setWalletError(errorMessage(error) || "No se pudo conectar con Freighter.");
    } finally {
      setConnecting(false);
    }
  }

  function disconnectWallet() {
    setAddress(null);
    setNotice(null);
  }

  async function handleDonate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const stroops = xlmToStroops(amount);
    if (stroops === null || stroops <= 0n) {
      setNotice({ kind: "error", message: "Ingresa un monto válido en XLM (hasta 7 decimales)." });
      return;
    }
    if (!campaign || campaign.status !== "Active") return;

    if (IS_DEMO) {
      setCampaign((prev) => prev && applyDonation(prev, stroops));
      setAmount("");
      setNotice({
        kind: "info",
        message: `Modo demo: se sumaron ${formatXlm(stroops, 7)} XLM solo al estado local.`,
      });
      return;
    }

    if (!address) {
      setNotice({ kind: "error", message: "Conecta tu billetera Freighter para donar." });
      return;
    }

    try {
      // Usa la cuenta activa en Freighter por si el usuario cambió de cuenta.
      const active = await getAddress();
      const donor = active.address || address;
      if (donor !== address) setAddress(donor);

      const hash = await donate(donor, stroops, setPhase);

      setCampaign((prev) => prev && applyDonation(prev, stroops));
      setAmount("");
      setNotice({
        kind: "success",
        message: `¡Gracias! Enviaste ${formatXlm(stroops, 7)} XLM al creador y la donación quedó registrada on-chain.`,
        hash,
      });
      void loadCampaign(true);
      void refreshBalance(donor);
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setPhase(null);
    }
  }

  const busy = phase !== null;
  const completed = campaign?.status === "Completed";
  const percent = campaign ? progressPercent(campaign.currentAmount, campaign.targetAmount) : 0;
  const remaining =
    campaign && campaign.targetAmount > campaign.currentAmount
      ? campaign.targetAmount - campaign.currentAmount
      : 0n;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-3xl" />

      <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/30">
            <HeartHandshake className="size-5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">StellarSponsor</p>
            <p className="text-xs text-slate-400">Micro-mecenazgo en Soroban</p>
          </div>
        </div>

        <WalletButton
          address={address}
          connecting={connecting}
          onConnect={connectWallet}
          onDisconnect={disconnectWallet}
        />
      </header>

      <main className="relative mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        {(walletError || freighterMissing) && (
          <div className="mb-6">
            <NoticeBox kind="error">
              {freighterMissing ? (
                <>
                  No detectamos la extensión Freighter.{" "}
                  <a
                    href={FREIGHTER_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline underline-offset-2 hover:text-white"
                  >
                    Instálala aquí
                  </a>{" "}
                  y recarga la página.
                </>
              ) : (
                walletError
              )}
            </NoticeBox>
          </div>
        )}

        <section className="mb-10 mt-6 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <ShieldCheck className="size-3.5" />
            Stellar Testnet · Soroban
          </span>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Micro-mecenazgo{" "}
            <span className="bg-linear-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">
              transparente
            </span>
          </h1>
          <p className="mt-4 text-slate-400">
            Apoya proyectos con XLM. Cada donación la firma tu billetera, llega directo al creador
            y queda registrada en un contrato inteligente que cualquiera puede auditar.
          </p>
        </section>

        {IS_DEMO && (
          <div className="mb-6">
            <NoticeBox kind="info">
              <strong className="font-semibold">Modo demo.</strong> Define{" "}
              <code className="rounded bg-white/10 px-1 py-0.5 text-xs">NEXT_PUBLIC_CONTRACT_ID</code>{" "}
              en <code className="rounded bg-white/10 px-1 py-0.5 text-xs">.env.local</code> para
              conectar la dApp a tu contrato en Testnet.
            </NoticeBox>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* ─── Tarjeta de progreso ─────────────────────────── */}
          <section className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl shadow-black/40 backdrop-blur lg:col-span-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Campaña
                </p>
                {campaign ? (
                  <h2 className="mt-1 text-xl font-semibold text-white wrap-break-word">
                    {campaign.title}
                  </h2>
                ) : (
                  <div className="mt-2 h-6 w-56 animate-pulse rounded bg-white/10" />
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {campaign && <StatusBadge completed={completed} />}
                {!IS_DEMO && (
                  <button
                    type="button"
                    onClick={() => void loadCampaign()}
                    disabled={loadingCampaign}
                    title="Actualizar desde la red"
                    className="grid size-8 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:border-white/20 hover:text-white disabled:opacity-50"
                  >
                    <RefreshCw className={`size-4 ${loadingCampaign ? "animate-spin" : ""}`} />
                  </button>
                )}
              </div>
            </div>

            {campaignError && (
              <div className="mt-5">
                <NoticeBox kind="error">{campaignError}</NoticeBox>
              </div>
            )}

            {loadingCampaign && !campaign ? (
              <div className="mt-8 space-y-4">
                <div className="h-10 w-2/3 animate-pulse rounded bg-white/10" />
                <div className="h-3 w-full animate-pulse rounded-full bg-white/10" />
                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
                  ))}
                </div>
              </div>
            ) : (
              campaign && (
                <>
                  <div className="mt-8 flex flex-wrap items-end justify-between gap-2">
                    <p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      {formatXlm(campaign.currentAmount)}{" "}
                      <span className="text-lg font-medium text-slate-400">
                        / {formatXlm(campaign.targetAmount)} XLM
                      </span>
                    </p>
                    <p className="text-2xl font-semibold text-indigo-300">{percent.toFixed(2)}%</p>
                  </div>

                  <ProgressBar percent={percent} completed={completed} />

                  <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Stat icon={<Coins className="size-4" />} label="Recaudado">
                      {formatXlm(campaign.currentAmount)} XLM
                    </Stat>
                    <Stat icon={<Target className="size-4" />} label="Meta">
                      {formatXlm(campaign.targetAmount)} XLM
                    </Stat>
                    <Stat icon={<Flag className="size-4" />} label="Restante">
                      {formatXlm(remaining)} XLM
                    </Stat>
                  </dl>

                  <p className="mt-6 flex items-center gap-2 text-sm text-slate-400">
                    Creador:
                    {IS_DEMO ? (
                      <span className="font-mono text-slate-300">
                        {shortenAddress(campaign.creator)}
                      </span>
                    ) : (
                      <a
                        href={explorerLink("account", campaign.creator)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-slate-300 hover:text-white"
                      >
                        {shortenAddress(campaign.creator)}
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </p>
                </>
              )
            )}
          </section>

          {/* ─── Formulario de donación ──────────────────────── */}
          <section className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl shadow-black/40 backdrop-blur lg:col-span-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Rocket className="size-5 text-fuchsia-300" />
              Hacer una donación
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {IS_DEMO
                ? "En modo demo la donación solo actualiza el estado local."
                : "El contrato transfiere tu XLM directo al creador; tú firmas con Freighter."}
            </p>

            <form onSubmit={handleDonate} className="mt-6 space-y-4">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="amount" className="text-sm font-medium text-slate-300">
                  Monto
                </label>
                {balance !== null && (
                  <span className="text-xs text-slate-500">
                    Saldo: <span className="text-slate-300">{formatXlm(balance)} XLM</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  id="amount"
                  type="number"
                  inputMode="decimal"
                  min="0.0000001"
                  step="0.0000001"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy || completed}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-3 pl-4 pr-16 text-lg text-white placeholder:text-slate-600 outline-none transition focus:border-indigo-400/60 focus:ring-4 focus:ring-indigo-500/15 disabled:opacity-50"
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-slate-400">
                  XLM
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => setAmount(quick)}
                    disabled={busy || completed}
                    className={`rounded-lg border py-2 text-sm font-medium transition disabled:opacity-50 ${
                      amount === quick
                        ? "border-indigo-400/60 bg-indigo-500/15 text-indigo-200"
                        : "border-white/10 text-slate-300 hover:border-white/20 hover:bg-white/5"
                    }`}
                  >
                    {quick}
                  </button>
                ))}
              </div>

              {!IS_DEMO && !address ? (
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={connecting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/10 py-3 font-semibold text-indigo-100 transition hover:bg-indigo-500/20 disabled:opacity-60"
                >
                  {connecting ? (
                    <LoaderCircle className="size-5 animate-spin" />
                  ) : (
                    <Wallet className="size-5" />
                  )}
                  Conecta Freighter para donar
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={busy || completed || !campaign || amount.trim() === ""}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 py-3 font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="size-5 animate-spin" />
                      {PHASE_LABEL[phase]}
                    </>
                  ) : completed ? (
                    <>
                      <CircleCheck className="size-5" />
                      Meta alcanzada
                    </>
                  ) : (
                    <>
                      <HeartHandshake className="size-5" />
                      Donar {amount.trim() ? `${amount.trim()} XLM` : ""}
                    </>
                  )}
                </button>
              )}
            </form>

            {notice && (
              <div className="mt-5">
                <NoticeBox kind={notice.kind}>
                  {notice.message}
                  {notice.hash && (
                    <a
                      href={explorerLink("tx", notice.hash)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 flex items-center gap-1 font-mono text-xs underline-offset-2 hover:underline"
                    >
                      Ver transacción {shortenAddress(notice.hash, 6)}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </NoticeBox>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-12 flex flex-col items-center gap-2 text-center text-xs text-slate-500">
          {CONTRACT_ID ? (
            <a
              href={explorerLink("contract", CONTRACT_ID)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono hover:text-slate-300"
            >
              Contrato {shortenAddress(CONTRACT_ID, 6)}
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <span>Sin contrato configurado</span>
          )}
          <span>Construido con Soroban, Next.js y Freighter</span>
        </footer>
      </main>
    </div>
  );
}

// ─── Componentes ─────────────────────────────────────────────

function WalletButton({
  address,
  connecting,
  onConnect,
  onDisconnect,
}: {
  address: string | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // El portapapeles puede no estar disponible (p. ej. sin HTTPS); no es crítico.
    }
  }

  if (!address) {
    return (
      <button
        type="button"
        onClick={onConnect}
        disabled={connecting}
        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-white/10 transition hover:bg-slate-200 disabled:opacity-60"
      >
        {connecting ? <LoaderCircle className="size-4 animate-spin" /> : <Wallet className="size-4" />}
        {connecting ? "Conectando…" : "Conectar Freighter"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-900/80 p-1 pl-3 backdrop-blur">
      <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
      <button
        type="button"
        onClick={copyAddress}
        title={address}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-sm text-slate-200 transition hover:bg-white/5"
      >
        {shortenAddress(address)}
        {copied ? (
          <Check className="size-3.5 text-emerald-400" />
        ) : (
          <Copy className="size-3.5 text-slate-500" />
        )}
      </button>
      <button
        type="button"
        onClick={onDisconnect}
        title="Desconectar"
        className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function ProgressBar({ percent, completed }: { percent: number; completed: boolean }) {
  // Arranca en 0 y anima hasta el valor real en el siguiente frame.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(Math.min(percent, 100)));
    return () => cancelAnimationFrame(frame);
  }, [percent]);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(percent, 100))}
      className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/10"
    >
      <div
        className={`relative h-full overflow-hidden rounded-full transition-[width] duration-1000 ease-out ${
          completed
            ? "bg-linear-to-r from-emerald-400 to-teal-300"
            : "bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
        }`}
        style={{ width: `${width}%` }}
      >
        <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-white/30 to-transparent" />
      </div>
    </div>
  );
}

function StatusBadge({ completed }: { completed: boolean }) {
  return completed ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
      <CircleCheck className="size-3.5" />
      Completada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300">
      <span className="size-1.5 animate-pulse rounded-full bg-sky-300" />
      Activa
    </span>
  );
}

function Stat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <dt className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-slate-100">{children}</dd>
    </div>
  );
}

function NoticeBox({ kind, children }: { kind: Notice["kind"]; children: ReactNode }) {
  const styles = {
    success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
    error: "border-rose-400/30 bg-rose-500/10 text-rose-100",
    info: "border-sky-400/30 bg-sky-500/10 text-sky-100",
  }[kind];
  const Icon = { success: CircleCheck, error: TriangleAlert, info: Info }[kind];

  return (
    <div className={`flex animate-fade-in gap-3 rounded-xl border p-4 text-sm ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
