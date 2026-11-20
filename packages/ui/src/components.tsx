import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  outline: 'border border-line-strong bg-card-2 text-ink hover:border-muted',
  ghost: 'bg-transparent text-accent hover:bg-accent-soft',
  danger: 'border border-danger/40 bg-transparent text-danger hover:bg-danger/10',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        buttonVariants[variant],
        className,
      )}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-2xl border border-line bg-card p-5 sm:p-6', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <span className="text-[11px] font-bold tracking-[0.18em] text-accent uppercase">{eyebrow}</span>}
        <h1 className="mt-1.5 text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

const inputBase =
  'rounded-lg border border-line-strong bg-page px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60';
/** Campo de formulário em largura total. */
export const inputClass = `w-full ${inputBase}`;
/** Campo compacto dentro de uma célula de tabela. */
export const cellInputClass = `${inputBase} w-auto min-w-28 max-w-48 py-1 text-xs`;

/** Largura total por padrão; passe uma classe `w-*` para mudar. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const hasWidth = /(^|\s)w-/.test(props.className ?? '');
  return <input {...props} className={cx(hasWidth ? inputBase : inputClass, props.className)} />;
}

/** Ajusta-se ao conteúdo por padrão; passe `w-full` quando quiser largura total. */
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputBase, 'pr-8', props.className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

type Tone = 'info' | 'error' | 'success' | 'warn';
const toneClass: Record<Tone, string> = {
  info: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  error: 'border-danger/40 bg-danger/10 text-red-100',
  success: 'border-accent/40 bg-accent/10 text-emerald-100',
  warn: 'border-warn/40 bg-warn/10 text-amber-100',
};
const toneIcon: Record<Tone, string> = { info: 'ℹ', error: '⚠', success: '✓', warn: '!' };

export function Notice({ tone = 'info', children, onClose }: { tone?: Tone; children: ReactNode; onClose?: () => void }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', toneClass[tone])}>
      <span aria-hidden className="font-bold">{toneIcon[tone]}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {onClose && (
        <button onClick={onClose} className="text-current/70 hover:text-current" aria-label="Fechar aviso">
          ×
        </button>
      )}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger' }) {
  const cls = {
    neutral: 'bg-line text-ink-2',
    accent: 'bg-accent-soft text-accent',
    warn: 'bg-warn/15 text-amber-200',
    danger: 'bg-danger/15 text-red-200',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{children}</span>;
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card p-5">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-3 truncate text-lg font-semibold text-ink tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

/** Abas simples (segmented control). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-page p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            value === o.value ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const tableClass = 'w-full border-collapse text-[13px] whitespace-nowrap';
export const thClass = 'border-b border-line px-3 py-2.5 text-left font-medium text-muted';
export const tdClass = 'border-b border-line/70 px-3 py-2.5 align-middle';
