// PWA: registro do service worker e aviso de "instalar o app".
// Android/Chrome/Edge disparam `beforeinstallprompt` (dá para mostrar um botão "Instalar").
// iPhone/iPad não têm esse evento: lá só dá para explicar o caminho (Compartilhar → Adicionar à Tela de Início).
import { useEffect, useState } from 'react';
import { Button } from '@familia/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Chamado uma vez no main.tsx, antes do React: o evento pode chegar antes da tela montar. */
export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // em vez da barrinha automática do Chrome, mostramos o nosso aviso
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] service worker não registrado', e));
    });
  }
}

const DISMISS_KEY = 'familia:install-dismissed';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Aviso discreto para instalar o app. Some quando já está instalado ou se a pessoa dispensar. */
export function InstallBanner({ className = '' }: { className?: string }) {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  if (dismissed || isStandalone()) return null;
  const canPrompt = deferredPrompt !== null;
  if (!canPrompt && !isIos()) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sem armazenamento (aba anônima): só esconde agora
    }
    setDismissed(true);
  };

  const install = async () => {
    const prompt = deferredPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') setDismissed(true);
    else rerender((n) => n + 1);
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm ${className}`}>
      <span aria-hidden className="text-xl text-accent">
        ◈
      </span>
      <div className="min-w-0 flex-1 text-ink-2">
        <b className="text-ink">Instale o app neste aparelho.</b>{' '}
        {canPrompt ? (
          'Abre em tela cheia, direto da tela inicial, como um app.'
        ) : (
          <>
            No iPhone, toque em <b className="text-ink">Compartilhar</b> (o quadrado com a seta) e depois em{' '}
            <b className="text-ink">Adicionar à Tela de Início</b>.
          </>
        )}
      </div>
      <div className="flex gap-2">
        {canPrompt && (
          <Button size="sm" onClick={install}>
            Instalar
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {canPrompt ? 'Agora não' : 'Entendi'}
        </Button>
      </div>
    </div>
  );
}
