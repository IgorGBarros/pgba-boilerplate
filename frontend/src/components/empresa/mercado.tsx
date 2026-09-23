// frontend/src/components/empresa/mercado.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart2,
  Brain,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Newspaper,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/empresa/shared";
import { askAsAgent, listAgents, type Agent, type AgentAskResult, type Sector } from "@/lib/api";
import type { AgentStatus } from "@/lib/pgba-data";

// ── TradingView singleton script loader ───────────────────────────────────────
let tvScriptReady = false;
const tvScriptQueue: (() => void)[] = [];

function ensureTvScript(cb: () => void) {
  if (tvScriptReady) { cb(); return; }
  tvScriptQueue.push(cb);
  if (document.getElementById("pgba-tv-script")) return;
  const s = document.createElement("script");
  s.id = "pgba-tv-script";
  s.src = "https://s3.tradingview.com/tv.js";
  s.onload = () => {
    tvScriptReady = true;
    tvScriptQueue.splice(0).forEach((fn) => fn());
  };
  document.head.appendChild(s);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TickerData {
  price: number;
  change: number;
  pct: number;
}

interface FearGreedData {
  value: number;
  label: string;
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedOn: number;
  categories: string;
}

interface BrapiResult {
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
}

interface BrapiResponse {
  results?: BrapiResult[];
}

interface AwesomeCurrency {
  bid: string;
  pctChange: string;
}

interface BinanceTicker {
  c: string;
  p: string;
  P: string;
}

interface FngResponse {
  data?: { value: string; value_classification: string }[];
}

interface CryptoCompareNews {
  id: number;
  title: string;
  url: string;
  source: string;
  source_info?: { name: string };
  published_on: number;
  categories: string;
}

interface CryptoCompareResponse {
  Data?: CryptoCompareNews[];
}

type CyclePhase = "pre" | "trading" | "post" | "closed";
type ChartInterval = "1" | "5" | "15" | "60" | "240" | "D";

interface TvSymbol {
  id: string;
  tv: string;
  label: string;
  currency: string;
  binance?: string;
  brapi?: string;
  awesome?: string;
}

const SYMBOLS: TvSymbol[] = [
  { id: "btc",    tv: "BINANCE:BTCUSDT",  label: "Bitcoin",     currency: "USD", binance: "btcusdt" },
  { id: "eth",    tv: "BINANCE:ETHUSDT",  label: "Ethereum",    currency: "USD", binance: "ethusdt" },
  { id: "ibov",   tv: "BMFBOVESPA:IBOV",  label: "IBOVESPA",    currency: "BRL", brapi: "IBOV"      },
  { id: "usdbrl", tv: "FX:USDBRL",        label: "USD/BRL",     currency: "BRL", awesome: "USD-BRL" },
  { id: "win",    tv: "BMFBOVESPA:IND1!", label: "Mini-Índice", currency: "BRL" },
  { id: "wdo",    tv: "BMFBOVESPA:DOL1!", label: "Mini-Dólar",  currency: "BRL" },
];

const INTERVALS: { value: ChartInterval; label: string }[] = [
  { value: "1",   label: "1m"  },
  { value: "5",   label: "5m"  },
  { value: "15",  label: "15m" },
  { value: "60",  label: "1h"  },
  { value: "240", label: "4h"  },
  { value: "D",   label: "1D"  },
];

const AUTONOMY_LABELS = ["Observador", "Recomendador", "Sup. Exec.", "Policy Exec.", "Autônomo"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMercadoSector(name: string) {
  const n = name.toLowerCase();
  return n.includes("mercado") || n.includes("inteligência de mercado") || n.includes("trading");
}

function getTradingPhase(): CyclePhase {
  const now = new Date();
  const brtOffset = -3 * 60;
  const localOffset = now.getTimezoneOffset();
  const brtMs = now.getTime() + (brtOffset - -localOffset) * 60 * 1000;
  const brt = new Date(brtMs);
  const t = brt.getHours() * 60 + brt.getMinutes();
  if (t >= 7 * 60 && t < 9 * 60 + 50)  return "pre";
  if (t >= 9 * 60 + 50 && t < 17 * 60 + 30) return "trading";
  if (t >= 17 * 60 + 30 && t < 17 * 60 + 50) return "post";
  return "closed";
}

const PHASE_LABELS: Record<CyclePhase, string> = {
  pre:     "Pré-abertura",
  trading: "Pregão ativo",
  post:    "Pós-pregão",
  closed:  "Mercado fechado",
};

const PHASE_COLORS: Record<CyclePhase, string> = {
  pre:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  trading: "bg-green-500/20 text-green-400 border-green-500/30",
  post:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  closed:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

function fmtPrice(price: number, currency: string) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(price);
  }
  if (price > 10_000) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(price);
  }
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(price);
}

function pctColor(pct: number) {
  if (pct > 0) return "text-green-400";
  if (pct < 0) return "text-red-400";
  return "text-muted-foreground";
}

function fearGreedColor(v: number) {
  if (v <= 25) return "#ef4444";
  if (v <= 45) return "#f97316";
  if (v <= 55) return "#eab308";
  if (v <= 75) return "#84cc16";
  return "#22c55e";
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function buildAgentQuestion(agent: Agent, priceCtx: string): string {
  const n = (agent.name + agent.role).toLowerCase();
  if (n.includes("orquestr"))
    return `${priceCtx}. Como Orquestrador, qual é o status do ciclo de hoje e o plano está ativo?`;
  if (n.includes("macro"))
    return `${priceCtx}. Qual o viés macro atual e há eventos de alto impacto nas próximas horas?`;
  if (n.includes("técnico") || n.includes("tecnico"))
    return `${priceCtx}. Quais os principais níveis técnicos a observar hoje — suportes, resistências e VWAP?`;
  if (n.includes("estrateg"))
    return `${priceCtx}. Existe algum cenário operável no plano de hoje com RR >= 2 e confluências confirmadas?`;
  if (n.includes("fluxo"))
    return `${priceCtx}. Qual a leitura de fluxo atual — CVD positivo ou negativo, há absorção ou exaustão visível?`;
  if (n.includes("guardião") || n.includes("risco"))
    return `${priceCtx}. Verifique se os limites operacionais estão dentro do permitido e se há algum veto ativo.`;
  if (n.includes("auditor"))
    return `${priceCtx}. Como está a aderência às regras até agora e houve alguma violação no ciclo de hoje?`;
  return `${priceCtx}. Qual sua avaliação da situação atual do mercado?`;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useBinanceTicker(symbol: string | undefined): TickerData | null {
  const [data, setData] = useState<TickerData | null>(null);
  const wsRef  = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!symbol) { setData(null); return; }
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@ticker`);
      wsRef.current = ws;
      ws.onmessage = (e: MessageEvent<string>) => {
        const d = JSON.parse(e.data) as BinanceTicker;
        setData({ price: parseFloat(d.c), change: parseFloat(d.p), pct: parseFloat(d.P) });
      };
      ws.onclose = () => {
        if (!cancelled) timerRef.current = setTimeout(connect, 3_000);
      };
    }
    connect();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [symbol]);

  return data;
}

function useBrapiTicker(ticker: string | undefined): TickerData | null {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    if (!ticker) { setData(null); return; }
    let active = true;

    async function poll() {
      try {
        const r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker!)}?range=1d&interval=1d`);
        if (!r.ok || !active) return;
        const json = (await r.json()) as BrapiResponse;
        const res = json?.results?.[0];
        if (!res) return;
        setData({ price: res.regularMarketPrice, change: res.regularMarketChange, pct: res.regularMarketChangePercent });
      } catch { /* network error — keep last value */ }
    }

    poll();
    const id = setInterval(poll, 30_000);
    return () => { active = false; clearInterval(id); };
  }, [ticker]);

  return data;
}

function useAwesomeTicker(pair: string | undefined): TickerData | null {
  const [data, setData] = useState<TickerData | null>(null);

  useEffect(() => {
    if (!pair) { setData(null); return; }
    let active = true;

    async function poll() {
      try {
        const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${pair}`);
        if (!r.ok || !active) return;
        const json = (await r.json()) as Record<string, AwesomeCurrency>;
        const d = Object.values(json)[0];
        if (!d) return;
        const price = parseFloat(d.bid);
        const pct   = parseFloat(d.pctChange);
        setData({ price, change: price * pct / 100, pct });
      } catch { /* keep last value */ }
    }

    poll();
    const id = setInterval(poll, 30_000);
    return () => { active = false; clearInterval(id); };
  }, [pair]);

  return data;
}

function useFearGreed(): FearGreedData | null {
  const [data, setData] = useState<FearGreedData | null>(null);

  useEffect(() => {
    fetch("https://api.alternative.me/fng/?limit=1")
      .then((r) => r.json())
      .then((json: FngResponse) => {
        const d = json?.data?.[0];
        if (d) setData({ value: parseInt(d.value, 10), label: d.value_classification });
      })
      .catch(() => {});
  }, []);

  return data;
}

function useCryptoNews() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH,Trading,Blockchain,Regulation&extraParams=pgba-mercado",
      );
      if (!r.ok) return;
      const json = (await r.json()) as CryptoCompareResponse;
      const items = (json.Data ?? []).slice(0, 20).map((d) => ({
        id: String(d.id),
        title: d.title,
        url: d.url,
        source: d.source_info?.name ?? d.source,
        publishedOn: d.published_on,
        categories: d.categories,
      }));
      setNews(items);
      setLastUpdated(new Date());
    } catch { /* keep last value */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void loadNews();
    const id = setInterval(() => void loadNews(), 5 * 60_000);
    return () => clearInterval(id);
  }, [loadNews]);

  return { news, loading, lastUpdated, refresh: loadNews };
}

// ── TradingView Chart ─────────────────────────────────────────────────────────

function TradingViewChart({ tvSymbol, interval }: { tvSymbol: string; interval: ChartInterval }) {
  const containerId = "pgba-tv-chart";

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    ensureTvScript(() => {
      if (!document.getElementById(containerId)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (window as any).TradingView.widget({
        autosize:          true,
        symbol:            tvSymbol,
        interval,
        timezone:          "America/Sao_Paulo",
        theme:             "dark",
        style:             "1",
        locale:            "br",
        toolbar_bg:        "#111111",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        container_id:      containerId,
        studies: [
          "RSI@tv-basicstudies",
          "MACD@tv-basicstudies",
          "Volume@tv-basicstudies",
        ],
      });
    });

    return () => {
      const c = document.getElementById(containerId);
      if (c) c.innerHTML = "";
    };
  }, [tvSymbol, interval]);

  return (
    <div
      id={containerId}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: 580 }}
    />
  );
}

// ── Price Card ────────────────────────────────────────────────────────────────

function PriceCard({
  sym,
  ticker,
  active,
  onClick,
}: {
  sym: TvSymbol;
  ticker: TickerData | null;
  active: boolean;
  onClick: () => void;
}) {
  const up = (ticker?.pct ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[120px] rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 ${
        active ? "border-primary/60 shadow-sm shadow-primary/10" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{sym.label}</span>
        {ticker ? (
          up ? <TrendingUp className="size-3 text-green-400 shrink-0" /> : <TrendingDown className="size-3 text-red-400 shrink-0" />
        ) : null}
      </div>
      {ticker ? (
        <>
          <div className="font-mono text-sm font-bold leading-tight tabular-nums">
            {fmtPrice(ticker.price, sym.currency)}
          </div>
          <div className={`text-[11px] font-mono mt-0.5 ${pctColor(ticker.pct)}`}>
            {ticker.pct >= 0 ? "+" : ""}{ticker.pct.toFixed(2)}%
          </div>
        </>
      ) : (
        <div className="space-y-1 mt-1">
          <div className="h-4 w-20 animate-pulse rounded bg-secondary/40" />
          <div className="h-3 w-12 animate-pulse rounded bg-secondary/30" />
        </div>
      )}
    </button>
  );
}

// ── Fear & Greed (compact horizontal) ────────────────────────────────────────

function FearGreedCompact({ data }: { data: FearGreedData | null }) {
  const color = data ? fearGreedColor(data.value) : "#374151";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="relative size-12 shrink-0">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
          <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
          {data && (
            <circle
              cx="24" cy="24" r="18"
              fill="none"
              stroke={color}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${(data.value / 100) * 113} 113`}
              className="transition-all duration-700"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {data ? (
            <span className="text-xs font-bold font-mono" style={{ color }}>{data.value}</span>
          ) : (
            <div className="size-4 rounded-full animate-pulse bg-secondary/30" />
          )}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fear &amp; Greed</p>
        {data ? (
          <p className="text-xs font-medium mt-0.5" style={{ color }}>{data.label}</p>
        ) : (
          <div className="h-3 w-16 mt-1 animate-pulse rounded bg-secondary/30" />
        )}
      </div>
    </div>
  );
}

// ── Guardian Panel ────────────────────────────────────────────────────────────

function GuardianPanel() {
  const limits = [
    { label: "Máx. operações",  value: "5 / dia"     },
    { label: "Perda máx.",      value: "R$ 150"      },
    { label: "Meta de parada",  value: "R$ 300"      },
    { label: "Perdas consec.",  value: "máx. 2"      },
    { label: "Pausa entre ops", value: "≥ 10 min"    },
    { label: "Janela B3",       value: "10h15–16h30" },
    { label: "Tamanho fixo",    value: "1 contrato"  },
  ];
  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Shield className="size-3.5 text-orange-400" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-400">Guardião · Limites</p>
        <Badge variant="outline" className="ml-auto text-[9px] px-1.5 border-orange-500/30 text-orange-400 leading-none">
          veto absoluto
        </Badge>
      </div>
      <div className="space-y-1">
        {limits.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between text-[11px] gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-medium text-orange-300 tabular-nums shrink-0">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cycle Bar ─────────────────────────────────────────────────────────────────

function CycleBar({ phase }: { phase: CyclePhase }) {
  const steps: { id: CyclePhase; label: string; time: string }[] = [
    { id: "pre",     label: "Pré-abertura", time: "07h00–09h50" },
    { id: "trading", label: "Pregão",       time: "09h50–17h30" },
    { id: "post",    label: "Pós-pregão",   time: "17h30–17h50" },
  ];
  const activeIdx = steps.findIndex((s) => s.id === phase);

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const done   = activeIdx > i;
        const active = activeIdx === i;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div
              className={`flex-1 h-7 flex items-center justify-center rounded-full px-3 text-[11px] font-medium border transition-colors ${
                active  ? "bg-primary/20 border-primary text-primary"
                : done  ? "bg-green-500/10 border-green-500/30 text-green-400/70"
                        : "bg-secondary/30 border-border text-muted-foreground"
              }`}
            >
              <span className="hidden sm:inline">{step.label} · </span>{step.time}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px w-2 ${done || active ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Agent Role Icon ───────────────────────────────────────────────────────────

function AgentRoleIcon({ role, name }: { role: string; name: string }) {
  const n = (role + name).toLowerCase();
  if (n.includes("orquestr"))                           return <Brain      className="size-3.5 text-primary"         />;
  if (n.includes("guardião") || n.includes("risco"))   return <Shield     className="size-3.5 text-orange-400"      />;
  if (n.includes("executor"))                           return <Zap        className="size-3.5 text-yellow-400"      />;
  if (n.includes("auditor"))                            return <CheckCircle className="size-3.5 text-blue-400"       />;
  if (n.includes("estrateg"))                           return <TrendingUp  className="size-3.5 text-green-400"      />;
  if (n.includes("coletor") || n.includes("dados"))    return <Activity   className="size-3.5 text-purple-400"      />;
  if (n.includes("macro"))                              return <BarChart2  className="size-3.5 text-cyan-400"        />;
  if (n.includes("técnico") || n.includes("tecnico"))  return <TrendingDown className="size-3.5 text-pink-400"      />;
  if (n.includes("fluxo"))                              return <Activity   className="size-3.5 text-indigo-400"      />;
  return <Users className="size-3.5 text-muted-foreground" />;
}

// ── Compact Agent Row ─────────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: Agent }) {
  const isOrch = agent.access_level === "sector_orchestrator";
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
        isOrch ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <AgentRoleIcon role={agent.role} name={agent.name} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-tight truncate">{agent.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{AUTONOMY_LABELS[agent.autonomy_level] ?? `nível ${agent.autonomy_level}`}</p>
      </div>
      <StatusDot status={agent.work_status as AgentStatus} />
    </div>
  );
}

// ── News Panel ────────────────────────────────────────────────────────────────

function NewsPanel({ news, loading, lastUpdated, refresh }: {
  news: NewsItem[];
  loading: boolean;
  lastUpdated: Date | null;
  refresh: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Newspaper className="size-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          Notícias · Cripto
        </p>
        {lastUpdated && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            {lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
          title="Atualizar notícias"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {loading && news.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3.5 w-full animate-pulse rounded bg-secondary/40" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-secondary/30" />
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <div className="p-6 flex flex-col items-center gap-2 text-muted-foreground">
            <Newspaper className="size-8 opacity-30" />
            <p className="text-sm">Nenhuma notícia disponível</p>
          </div>
        ) : (
          news.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 px-4 py-3 hover:bg-secondary/20 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-muted-foreground">{item.source}</span>
                  <span className="text-[10px] text-muted-foreground/60">·</span>
                  <span className="text-[10px] text-muted-foreground/60">{timeAgo(item.publishedOn)}</span>
                </div>
              </div>
              <ExternalLink className="size-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-1 transition-colors" />
            </a>
          ))
        )}
      </div>
    </div>
  );
}

// ── Agent Analysis Panel ──────────────────────────────────────────────────────

const KEY_ROLES = ["orquestr", "macro", "técnico", "tecnico", "estrateg", "fluxo", "guardião", "auditor"];

function isKeyAgent(agent: Agent): boolean {
  const n = (agent.name + agent.role).toLowerCase();
  return KEY_ROLES.some((r) => n.includes(r));
}

function AgentAnalysisPanel({ agents, priceContext }: { agents: Agent[]; priceContext: string }) {
  const keyAgents = agents.filter(isKeyAgent);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, AgentAskResult>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const active = activeId ?? keyAgents[0]?.id ?? null;
  const activeAgent = keyAgents.find((a) => a.id === active) ?? null;

  async function requestAnalysis(agent: Agent) {
    if (loadingId === agent.id) return;
    setLoadingId(agent.id);
    try {
      const q = buildAgentQuestion(agent, priceContext);
      const result = await askAsAgent(agent.id, q, false);
      setResults((prev) => ({ ...prev, [agent.id]: result }));
    } catch {
      setResults((prev) => ({
        ...prev,
        [agent.id]: {
          answer: "Erro ao contatar o agente. Tente novamente.",
          function_called: null,
          sources: [],
          status: "llm_error",
        },
      }));
    } finally {
      setLoadingId(null);
    }
  }

  if (keyAgents.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-center text-muted-foreground text-sm">
        Nenhum agente de mercado configurado.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          Análise dos Agentes
        </p>
        <Badge variant="outline" className="text-[9px] px-1.5 border-primary/30 text-primary leading-none">
          tempo real
        </Badge>
      </div>

      {/* Agent tabs */}
      <div className="flex gap-1 px-3 pt-2.5 pb-1 overflow-x-auto shrink-0">
        {keyAgents.map((agent) => {
          const hasResult = !!results[agent.id];
          const isActive = agent.id === active;
          return (
            <button
              key={agent.id}
              onClick={() => setActiveId(agent.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors shrink-0 ${
                isActive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              <AgentRoleIcon role={agent.role} name={agent.name} />
              <span className="max-w-[80px] truncate">{agent.name.replace(/de\s+mercado/i, "").trim()}</span>
              {hasResult && (
                <span className="size-1.5 rounded-full bg-green-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {activeAgent && (
        <div className="flex-1 flex flex-col gap-3 px-4 pb-4 pt-2 overflow-y-auto min-h-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <AgentRoleIcon role={activeAgent.role} name={activeAgent.name} />
              <span className="text-xs font-semibold">{activeAgent.name}</span>
              <StatusDot status={activeAgent.work_status as AgentStatus} />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={loadingId === activeAgent.id}
              onClick={() => void requestAnalysis(activeAgent)}
              className="h-7 text-xs gap-1.5 shrink-0"
            >
              {loadingId === activeAgent.id ? (
                <><Loader2 className="size-3 animate-spin" />Consultando…</>
              ) : (
                <><Brain className="size-3" />Solicitar análise</>
              )}
            </Button>
          </div>

          {results[activeAgent.id] ? (
            <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {results[activeAgent.id].answer}
              </p>
              {results[activeAgent.id].function_called && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  fn: {results[activeAgent.id].function_called}
                </p>
              )}
              {results[activeAgent.id].status !== "ok" && (
                <Badge variant="outline" className="text-[9px] px-1.5 border-destructive/30 text-destructive">
                  {results[activeAgent.id].status}
                </Badge>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-secondary/10 p-4 flex flex-col items-center gap-2 text-center">
              <Brain className="size-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                Clique em &quot;Solicitar análise&quot; para consultar este agente.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function SectorDetailPage({
  sector,
  onBack,
}: {
  sector: Sector;
  onBack: () => void;
}) {
  const [agents, setAgents]       = useState<Agent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [phase, setPhase]         = useState<CyclePhase>(getTradingPhase);
  const [selectedSym, setSelected] = useState<TvSymbol>(SYMBOLS[0]);
  const [interval, setChartInterval] = useState<ChartInterval>("15");

  const isMercado = isMercadoSector(sector.name);

  useEffect(() => {
    listAgents(sector.id)
      .then(setAgents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sector.id]);

  useEffect(() => {
    const tid = setInterval(() => setPhase(getTradingPhase()), 60_000);
    return () => clearInterval(tid);
  }, []);

  const btcTicker    = useBinanceTicker(SYMBOLS[0].binance);
  const ethTicker    = useBinanceTicker(SYMBOLS[1].binance);
  const ibovTicker   = useBrapiTicker(SYMBOLS[2].brapi);
  const usdbrlTicker = useAwesomeTicker(SYMBOLS[3].awesome);
  const fearGreed    = useFearGreed();
  const { news, loading: newsLoading, lastUpdated: newsUpdated, refresh: newsRefresh } = useCryptoNews();

  const tickerMap: Record<string, TickerData | null> = {
    btc:    btcTicker,
    eth:    ethTicker,
    ibov:   ibovTicker,
    usdbrl: usdbrlTicker,
  };

  const priceContext = [
    btcTicker  ? `BTC ${fmtPrice(btcTicker.price, "USD")} (${btcTicker.pct.toFixed(2)}%)` : null,
    ethTicker  ? `ETH ${fmtPrice(ethTicker.price, "USD")} (${ethTicker.pct.toFixed(2)}%)` : null,
    ibovTicker ? `IBOV ${fmtPrice(ibovTicker.price, "BRL")} (${ibovTicker.pct.toFixed(2)}%)` : null,
  ].filter(Boolean).join(", ") || "dados de mercado carregando";

  const sortedAgents = [
    ...agents.filter((a) => a.access_level === "sector_orchestrator"),
    ...agents.filter((a) => a.access_level === "operational"),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isMercado && <BarChart2 className="size-5 text-primary shrink-0" />}
            <h2 className="font-semibold text-lg truncate font-display">{sector.name}</h2>
            {isMercado && (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${PHASE_COLORS[phase]}`}>
                <Clock className="size-3 inline mr-1" />
                {PHASE_LABELS[phase]}
                {phase === "trading" && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-green-400 animate-pulse" />}
              </span>
            )}
          </div>
          {sector.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{sector.description}</p>
          )}
        </div>
      </div>

      {/* Cycle bar */}
      {isMercado && phase !== "closed" && <CycleBar phase={phase} />}
      {isMercado && phase === "closed" && (
        <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="size-4 text-zinc-400" />
          <p className="text-sm text-zinc-400">Mercado fechado — próximo ciclo às 07h00 BRT</p>
        </div>
      )}

      {/* Price cards + Fear & Greed */}
      {isMercado && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SYMBOLS.slice(0, 4).map((sym) => (
            <PriceCard
              key={sym.id}
              sym={sym}
              ticker={tickerMap[sym.id] ?? null}
              active={selectedSym.id === sym.id}
              onClick={() => setSelected(sym)}
            />
          ))}
          {SYMBOLS.slice(4).map((sym) => (
            <button
              key={sym.id}
              onClick={() => setSelected(sym)}
              className={`flex-1 min-w-[100px] rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 ${
                selectedSym.id === sym.id ? "border-primary/60" : "border-border"
              }`}
            >
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">{sym.label}</span>
              <span className="text-[11px] text-muted-foreground/60">ver no gráfico</span>
            </button>
          ))}
          <FearGreedCompact data={fearGreed} />
        </div>
      )}

      {/* Main trading panel */}
      {isMercado ? (
        <>
          {/* Top row: chart + agent sidebar */}
          <div className="flex gap-4 items-start">
            {/* Left sidebar: Guardian */}
            <div className="hidden lg:flex flex-col gap-3 w-44 shrink-0">
              <GuardianPanel />
            </div>

            {/* Center: chart */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* Symbol + interval selector */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {SYMBOLS.map((sym) => (
                    <button
                      key={sym.id}
                      onClick={() => setSelected(sym)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        selectedSym.id === sym.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary"
                      }`}
                    >
                      {sym.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv.value}
                      onClick={() => setChartInterval(iv.value)}
                      className={`rounded-md px-2 py-1 text-xs font-mono transition-colors ${
                        interval === iv.value
                          ? "bg-primary/20 text-primary border border-primary/40"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {iv.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* TradingView chart */}
              <div className="rounded-xl border border-border overflow-hidden bg-[#111]">
                <TradingViewChart tvSymbol={selectedSym.tv} interval={interval} />
              </div>
            </div>

            {/* Right sidebar: agents */}
            <div className="hidden lg:flex flex-col gap-2 w-48 shrink-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Agentes · {loading ? "…" : agents.length}
              </p>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-[52px] rounded-lg border border-border bg-card animate-pulse" />
                ))
              ) : (
                <div className="space-y-1.5">
                  {sortedAgents.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: News + Agent Analysis */}
          <div className="grid gap-4 lg:grid-cols-2" style={{ height: 420 }}>
            <NewsPanel
              news={news}
              loading={newsLoading}
              lastUpdated={newsUpdated}
              refresh={newsRefresh}
            />
            <AgentAnalysisPanel agents={sortedAgents} priceContext={priceContext} />
          </div>

          {/* Mobile: Guardian below chart */}
          <div className="lg:hidden">
            <GuardianPanel />
          </div>

          {/* Mobile agents */}
          {!loading && agents.length > 0 && (
            <div className="lg:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Agentes ({agents.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {sortedAgents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Generic sector view */
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">Agentes</p>
              <p className="text-2xl font-bold mt-1">{loading ? "—" : agents.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">Trabalhando agora</p>
              <p className="text-2xl font-bold mt-1 text-green-400">
                {loading ? "—" : agents.filter((a) => a.work_status === "working").length}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">Base de conhecimento</p>
              <p className="text-sm font-medium mt-1 truncate">
                {sector.knowledge_source_name ?? <span className="text-muted-foreground">—</span>}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sortedAgents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
