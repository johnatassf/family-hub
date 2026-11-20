import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Field, Input, Notice, Segmented, errorMessage } from '@familia/ui';
import { AuthError, authCall } from '../lib/auth';
import { usePublicConfig } from '../lib/config';
import { Turnstile } from '../lib/Turnstile';
import { AuthShell, GoogleButton } from './AuthShell';

/** 'totp' = segunda etapa pelo app autenticador; 'email-2fa' = segunda etapa por código no e-mail. */
type Step = 'form' | 'code' | 'totp' | 'email-2fa' | 'verify-email';

interface SignInResponse {
  twoFactorRedirect?: boolean;
  /** O que a conta aceita na segunda etapa ('totp' só aparece se ela configurou o app). */
  twoFactorMethods?: string[];
}

/** Só aceita caminhos internos como destino depois do login (evita redirecionamento aberto). */
export const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/');

export function Login() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const config = usePublicConfig();

  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('erro') === 'google' ? 'Não foi possível entrar com o Google. Você tem convite?' : null);
  const [info, setInfo] = useState<string | null>(null);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    navigate(next, { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setCaptchaRound((n) => n + 1); // token do Turnstile é de uso único
    }
  };

  const sendCode = (type: 'sign-in' | 'email-verification') =>
    authCall('/email-otp/send-verification-otp', { email, type }, { captcha });

  const sendTwoFactorEmail = () => authCall('/two-factor/send-otp', {});

  /** Senha aceita e a conta tem 2FA: app autenticador se ela tiver; senão, código por e-mail. */
  const startSecondFactor = async (res: SignInResponse) => {
    setCode('');
    setUseBackup(false);
    if (res.twoFactorMethods?.includes('totp')) {
      setStep('totp');
      return;
    }
    await sendTwoFactorEmail();
    setInfo(`Enviamos um código de verificação para ${email}.`);
    setStep('email-2fa');
  };

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'code') {
        await sendCode('sign-in');
        setInfo(`Se ${email} tiver acesso, enviamos um código de 6 dígitos.`);
        setStep('code');
        return;
      }
      try {
        const res = await authCall<SignInResponse>('/sign-in/email', { email, password }, { captcha });
        if (res.twoFactorRedirect) {
          await startSecondFactor(res);
          return;
        }
        await done();
      } catch (err) {
        if (err instanceof AuthError && err.code === 'EMAIL_NOT_VERIFIED') {
          setStep('verify-email');
          setInfo('Seu e-mail ainda não foi confirmado. Enviamos um código para ele.');
          return;
        }
        throw err;
      }
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (step === 'code') {
        await authCall('/sign-in/email-otp', { email, otp: code });
        await done();
      } else if (step === 'verify-email') {
        await authCall('/email-otp/verify-email', { email, otp: code });
        const res = await authCall<SignInResponse>('/sign-in/email', { email, password });
        if (res.twoFactorRedirect) {
          await startSecondFactor(res);
          return;
        }
        await done();
      } else if (step === 'email-2fa') {
        await authCall('/two-factor/verify-otp', { code: code.trim(), trustDevice });
        await done();
      } else {
        await authCall(useBackup ? '/two-factor/verify-backup-code' : '/two-factor/verify-totp', { code: code.trim(), trustDevice });
        await done();
      }
    });
  };

  const needsCaptcha = Boolean(config.data?.turnstileSiteKey);

  if (step !== 'form') {
    const twoFactorStep = step === 'totp' || step === 'email-2fa';
    const title = twoFactorStep ? 'Verificação em duas etapas' : step === 'verify-email' ? 'Confirme seu e-mail' : 'Digite o código';
    return (
      <AuthShell
        title={title}
        subtitle={step === 'totp' ? (useBackup ? 'Use um dos seus códigos de backup.' : 'Abra o app autenticador e digite o código de 6 dígitos.') : info}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <form onSubmit={submitCode} className="grid gap-4">
          <Field label={step === 'totp' && useBackup ? 'Código de backup' : 'Código'}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={useBackup ? 32 : 6}
              className="text-center font-mono text-lg tracking-[0.4em]"
            />
          </Field>
          {twoFactorStep && (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
              Confiar neste dispositivo por 30 dias
            </label>
          )}
          <Button type="submit" loading={busy}>
            Entrar
          </Button>
          <div className="flex justify-between text-xs">
            <button type="button" className="text-muted hover:text-ink" onClick={() => (setStep('form'), setCode(''), setError(null))}>
              ← Voltar
            </button>
            {step === 'totp' ? (
              <button type="button" className="text-accent hover:underline" onClick={() => (setUseBackup((v) => !v), setCode(''))}>
                {useBackup ? 'Usar o app autenticador' : 'Usar código de backup'}
              </button>
            ) : step === 'email-2fa' ? (
              <button type="button" className="text-accent hover:underline" disabled={busy} onClick={() => run(() => sendTwoFactorEmail().then(() => setInfo(`Código reenviado para ${email}.`)))}>
                Reenviar código
              </button>
            ) : (
              <button type="button" className="text-accent hover:underline" disabled={busy} onClick={() => run(() => sendCode(step === 'code' ? 'sign-in' : 'email-verification').then(() => setInfo('Código reenviado.')))}>
                Reenviar código
              </button>
            )}
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesso só para quem foi convidado por alguém da família."
      footer={
        <>
          Recebeu um convite? <Link to={`/cadastro${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-accent hover:underline">Criar conta com senha</Link>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <GoogleButton next={next} />
      <div className="mb-5">
        <Segmented
          label="Forma de entrar"
          value={mode}
          onChange={(v) => (setMode(v), setError(null))}
          options={[
            { value: 'code', label: 'Código por e-mail' },
            { value: 'password', label: 'Senha' },
          ]}
        />
      </div>
      <form onSubmit={submitForm} className="grid gap-4">
        <Field label="E-mail">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </Field>
        {mode === 'password' && (
          <Field label="Senha" hint={<Link to="/esqueci-senha" className="text-accent hover:underline">Esqueci a senha</Link>}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
        )}
        <Turnstile siteKey={config.data?.turnstileSiteKey} onToken={setCaptcha} resetKey={captchaRound} />
        <Button type="submit" loading={busy} disabled={needsCaptcha && !captcha}>
          {mode === 'code' ? 'Enviar código' : 'Entrar'}
        </Button>
        {mode === 'code' && <p className="text-xs text-muted">Contas com verificação em duas etapas entram com senha (e o código do app ou do e-mail) ou com o Google.</p>}
      </form>
    </AuthShell>
  );
}
