import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePublicConfig } from '../lib/config';
import { InstallBanner } from '../lib/install';

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const config = usePublicConfig();
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 block text-center text-xl text-accent">
          ◈ <b>{config.data?.appName ?? 'Família'}</b>
        </Link>
        <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
          <h1 className="text-xl font-bold text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-muted">{footer}</div>}
        <InstallBanner className="mt-6" />
      </div>
    </div>
  );
}

export function GoogleButton({ next }: { next: string }) {
  const config = usePublicConfig();
  if (!config.data?.googleEnabled) return null;
  const go = async () => {
    const res = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ provider: 'google', callbackURL: next, errorCallbackURL: '/login?erro=google' }),
    });
    const data = (await res.json()) as { url?: string };
    if (data.url) window.location.href = data.url;
  };
  return (
    <>
      <button
        type="button"
        onClick={go}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Entrar com Google
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
