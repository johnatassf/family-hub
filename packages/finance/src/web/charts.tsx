import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHART_SERIES, Empty, cx, formatMonth, tableClass, tdClass, thClass } from '@familia/ui';
import { formatBRL } from '../shared';

/**
 * Paleta categórica validada contra a superfície dos cartões (#141f2b): banda de luminosidade, croma,
 * separação para daltonismo entre vizinhos e contraste. A ordem é o mecanismo de segurança: não reordenar.
 */
export const SERIES = CHART_SERIES;
const INK = '#e7eaf0';
const GRID = '#263747';
const AXIS = '#344253';
const MUTED = '#8d9aab';
const compactBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

/**
 * Barras empilhadas por mês (valores em centavos), com linha opcional no mesmo eixo (ex.: renda).
 * Sempre com legenda (≥ 2 séries), tooltip por mês e tabela acessível.
 */
export function StackedMonthsChart({
  rows,
  series,
  line,
  height = 288,
  label,
}: {
  rows: { month: string; [key: string]: number | string }[];
  series: SeriesDef[];
  line?: SeriesDef;
  height?: number;
  label: string;
}) {
  if (!rows.length) return <Empty>Sem dados para o período.</Empty>;
  const data = rows.map((r) => {
    const out: Record<string, number | string> = { month: r.month, label: formatMonth(r.month) };
    for (const s of series) out[s.key] = Number(r[s.key] ?? 0) / 100;
    if (line) out[line.key] = Number(r[line.key] ?? 0) / 100;
    return out;
  });
  return (
    <div>
      {/* Legenda própria: na ordem da pilha (de baixo para cima) e com o texto na cor de leitura. */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
        {line && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: line.color }} aria-hidden />
            {line.label}
          </li>
        )}
      </ul>
      <div style={{ height }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AXIS }} tick={{ fill: MUTED, fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v: number) => compactBRL.format(v)} tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 11 }} width={64} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={({ active, payload }) => {
                const p = active ? payload?.[0]?.payload : null;
                if (!p) return null;
                return (
                  <div className="min-w-48 rounded-lg border border-line-strong bg-page px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1.5 text-muted">{p.label}</div>
                    {[...(line ? [line] : []), ...series].map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                        <span className="flex items-center gap-1.5 text-ink-2">
                          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                          {s.label}
                        </span>
                        <span className="font-medium text-ink tabular-nums">{formatBRL(Math.round((p[s.key] as number) * 100))}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="total"
                fill={s.color}
                maxBarSize={28}
                isAnimationActive={false}
                // 2px na cor da superfície entre segmentos; só o topo da pilha arredonda.
                stroke="#141f2b"
                strokeWidth={1}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
            {line && <Line type="linear" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2} dot={{ r: 4, fill: line.color, stroke: '#141f2b', strokeWidth: 2 }} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none hover:text-ink-2">Ver como tabela</summary>
        <div className="-mx-2 mt-2 overflow-x-auto px-2">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Mês</th>
                {[...(line ? [line] : []), ...series].map((s) => (
                  <th key={s.key} className={cx(thClass, 'text-right')}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td className={tdClass}>{formatMonth(r.month)}</td>
                  {[...(line ? [line] : []), ...series].map((s) => (
                    <td key={s.key} className={cx(tdClass, 'text-right tabular-nums')}>
                      {formatBRL(Number(r[s.key] ?? 0))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export const LINE_INK: SeriesDef['color'] = INK;

/** Barra de progresso simples (meta, parcelas pagas, limite usado). */
export function Progress({ value, max, tone = 'accent', label }: { value: number; max: number; tone?: 'accent' | 'warn' | 'danger'; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = { accent: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-line/70" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
