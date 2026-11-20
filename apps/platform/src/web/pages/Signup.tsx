import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Field, Input, Notice, errorMessage } from '@familia/ui';
import { authCall } from '../lib/auth';
import { usePublicConfig } from '../lib/config';
import { Turnstile } from '../lib/Turnstile';
import { AuthShell, GoogleButton } from './AuthShell';

export function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = usePublicConfig();
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setRound((n) => n + 1);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authCall('/sign-up/email', { name, email, password }, { captcha });
      setStep('verify');
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authCall('/email-otp/verify-email', { email, otp: code });
      await authCall('/sign-in/email', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    });
  };

  if (step === 'verify') {
    return (
      <AuthShell title="Confirme seu e-mail" subtitle={`Se ${email} tiver um convite válido, enviamos um código de 6 dígitos.`}>
        {error && <Notice tone="error">{error}</Notice>}
        <form onSubmit={verify} className="grid gap-4">
          <Field label="Código">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="text-center font-mono text-lg tracking-[0.4em]" />
          </Field>
          <Button type="submit" loading={busy}>
            Confirmar e entrar
          </Button>
          <p className="text-xs text-muted">Não chegou? Confira o spam. Sem convite, nenhum e-mail é enviado — peça um a alguém da sua família.</p>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Use o mesmo e-mail que recebeu o convite."
      footer={
        <>
          Já tem conta? <Link to="/login" className="text-accent hover:underline">Entrar</Link>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <GoogleButton next="/" />
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Senha" hint="Mínimo de 10 caracteres. Uma frase é mais fácil de lembrar e mais difícil de adivinhar.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={10} maxLength={128} />
        </Field>
        <Turnstile siteKey={config.data?.turnstileSiteKey} onToken={setCaptcha} resetKey={round} />
        <Button type="submit" loading={busy} disabled={Boolean(config.data?.turnstileSiteKey) && !captcha}>
          Criar conta
        </Button>
      </form>
    </AuthShell>
  );
}
