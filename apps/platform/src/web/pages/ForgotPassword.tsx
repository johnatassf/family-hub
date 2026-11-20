import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Button, Field, Input, Notice, errorMessage } from '@familia/ui';
import { authCall } from '../lib/auth';
import { usePublicConfig } from '../lib/config';
import { Turnstile } from '../lib/Turnstile';
import { AuthShell } from './AuthShell';

/** Redefinir senha por código. Também serve para quem só entra com Google/código e quer criar uma senha. */
export function ForgotPassword() {
  const config = usePublicConfig();
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
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

  const request = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authCall('/email-otp/request-password-reset', { email }, { captcha });
      setStep('reset');
    });
  };
  const reset = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await authCall('/email-otp/reset-password', { email, otp: code, password });
      setStep('done');
    });
  };

  return (
    <AuthShell
      title="Redefinir senha"
      subtitle={step === 'reset' ? `Se ${email} tiver conta, enviamos um código.` : undefined}
      footer={<Link to="/login" className="text-accent hover:underline">← Voltar para o login</Link>}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {step === 'done' ? (
        <Notice tone="success">
          Senha alterada e outras sessões encerradas. <Link to="/login" className="underline">Entrar</Link>
        </Notice>
      ) : step === 'email' ? (
        <form onSubmit={request} className="grid gap-4">
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </Field>
          <Turnstile siteKey={config.data?.turnstileSiteKey} onToken={setCaptcha} resetKey={round} />
          <Button type="submit" loading={busy} disabled={Boolean(config.data?.turnstileSiteKey) && !captcha}>
            Enviar código
          </Button>
        </form>
      ) : (
        <form onSubmit={reset} className="grid gap-4">
          <Field label="Código">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required autoFocus className="text-center font-mono tracking-[0.4em]" />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 10 caracteres.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
          </Field>
          <Button type="submit" loading={busy}>
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
