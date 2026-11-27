import React, { useState } from 'react';
import { formatEUR } from '../lib/api';

export interface MonthlyChartPoint {
  month: string;
  label: string;
  billed: number;
  received: number;
  techPayout: number;
  realProfit?: number;
}

export interface ExpenseCategoryPoint {
  category: string;
  amount: number;
}

export function BilledVsReceivedChart({ data }: { data: MonthlyChartPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const maxVal = Math.max(100, ...data.flatMap((d) => [d.billed, d.received]));
  const width = 520;
  const height = 210;
  const padLeft = 52;
  const padBottom = 28;
  const padTop = 16;
  const plotW = width - padLeft - 12;
  const plotH = height - padTop - padBottom;
  const groupW = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.min(20, Math.max(10, (groupW - 14) / 2));

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-900" />
            Faturado
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
            Recebido / Liquidado
          </span>
        </div>
        {hoverIdx !== null && data[hoverIdx] && (
          <span className="font-mono text-[11px] text-slate-700 tabular-nums">
            {data[hoverIdx].label}: {formatEUR(data[hoverIdx].billed)} / {formatEUR(data[hoverIdx].received)}
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + plotH * (1 - t);
          const v = Math.round(maxVal * t);
          return (
            <g key={t}>
              <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono tabular-nums"
              >
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const cx = padLeft + idx * groupW + groupW / 2;
          const billedH = Math.max(2, (d.billed / maxVal) * plotH);
          const recH = Math.max(2, (d.received / maxVal) * plotH);
          const isHovered = hoverIdx === idx;
          return (
            <g
              key={d.month}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              {isHovered && (
                <rect
                  x={cx - groupW / 2 + 2}
                  y={padTop}
                  width={groupW - 4}
                  height={plotH}
                  rx={4}
                  fill="#f8fafc"
                />
              )}
              <rect
                x={cx - barW - 2}
                y={padTop + plotH - billedH}
                width={barW}
                height={billedH}
                rx={3}
                fill="#0f172a"
              />
              <rect
                x={cx + 2}
                y={padTop + plotH - recH}
                width={barW}
                height={recH}
                rx={3}
                fill="#059669"
              />
              <text
                x={cx}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-medium"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SingleMetricLineOrBarChart({
  data,
  valueKey,
  color,
  label,
}: {
  data: MonthlyChartPoint[];
  valueKey: 'realProfit' | 'techPayout';
  color: string;
  label: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const values = data.map((d) => Number(d[valueKey] || 0));
  const maxVal = Math.max(100, ...values);
  const width = 520;
  const height = 200;
  const padLeft = 52;
  const padBottom = 28;
  const padTop = 16;
  const plotW = width - padLeft - 16;
  const plotH = height - padTop - padBottom;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : plotW;

  const points = data.map((d, idx) => {
    const val = Number(d[valueKey] || 0);
    const x = data.length === 1 ? padLeft + plotW / 2 : padLeft + idx * stepX;
    const y = padTop + plotH - (val / maxVal) * plotH;
    return { x, y, val, label: d.label, month: d.month };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          {label}
        </span>
        {hoverIdx !== null && points[hoverIdx] && (
          <span className="font-mono text-[11px] text-slate-700 tabular-nums">
            {points[hoverIdx].label}: {formatEUR(points[hoverIdx].val)}
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + plotH * (1 - t);
          const v = Math.round(maxVal * t);
          return (
            <g key={t}>
              <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono tabular-nums"
              >
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
              </text>
            </g>
          );
        })}

        {points.length > 1 && (
          <polyline
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polyline}
          />
        )}

        {points.map((p, idx) => (
          <g
            key={p.month}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            className="cursor-pointer"
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={hoverIdx === idx ? 5.5 : 4}
              fill={color}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <text
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-slate-500 text-[11px] font-medium"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const EXPENSE_LABELS: Record<string, string> = {
  weekly_payout: 'Repasses Semanais',
  supplier_parts: 'Peças & Fornecedores',
  impostos_iva: 'IVA / Impostos',
  combustivel: 'Combustível & Frota',
  renda_escritorio: 'Renda / Escritório',
  telecomunicacoes: 'Telecomunicações',
  seguros: 'Seguros',
  marketing: 'Marketing',
  ferramentas: 'Ferramentas & Equip.',
  contabilidade: 'Contabilidade',
  software: 'Software & Cloud',
};

export function ExpensesCategoryChart({ data }: { data: ExpenseCategoryPoint[] }) {
  const maxVal = Math.max(100, ...data.map((d) => d.amount));
  const total = data.reduce((s, d) => s + d.amount, 0);

  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-400">
        Sem despesas registadas no Fluxo de Caixa.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const pct = total > 0 ? Math.round((item.amount / total) * 100) : 0;
        const barPct = Math.max(4, Math.round((item.amount / maxVal) * 100));
        return (
          <div key={item.category} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 truncate">
                {EXPENSE_LABELS[item.category] || item.category}
              </span>
              <span className="font-mono text-slate-900 tabular-nums shrink-0">
                {formatEUR(item.amount)}{' '}
                <span className="text-[11px] text-slate-400">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-slate-800 transition-all"
                style={{ width: `${barPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
