import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { renderSVG } from 'uqr';
import { Button, Card, Field, Input, Loading, Notice, PageHeader, Pill, errorMessage, formatDateTime, useSession } from '@familia/ui';
import { authCall, signOut } from '../lib/auth';

interface SessionRow {
  id: string;
  token?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  updatedAt: string;
}

const device = (ua?: string | null) => {
  if (!ua) return 'Dispositivo desconhecido';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${browser} · ${os}`;
};

function useHasPassword() {
  return useQuery({
    queryKey: ['auth', 'accounts'],
    queryFn: () => authCall<{ providerId: string }[]>('/list-accounts'),
    select: (accounts) => accounts.some((a) => a.providerId === 'credential'),
  });
}

function TwoFactorCard() {
  const { me } = useSession();
  const qc = useQueryClient();
  const hasPassword = useHasPassword();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });
  const pwd = hasPassword.data ? { password } : {};

  const enable = useMutation({
    mutationFn: () => authCall<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', pwd),
    onSuccess: (data) => (setSetup(data), setPassword('')),
  });
  const verify = useMutation({
    mutationFn: () => authCall('/two-factor/verify-totp', { code: code.trim() }),
    onSuccess: () => (setCodes(setup?.backupCodes ?? null), setSetup(null), setCode(''), refresh()),
  });
  const disable = useMutation({ mutationFn: () => authCall('/two-factor/disable', pwd), onSuccess: () => (setPassword(''), refresh()) });
  const regenerate = useMutation({
    mutationFn: () => authCall<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', pwd),
    onSuccess: (d) => (setCodes(d.backupCodes), setPassword('')),
  });
  const error = enable.error ?? verify.error ?? disable.error ?? regenerate.error;

  const passwordField = hasPassword.data && (
    <Field label="Sua senha">
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
    </Field>
  );

  return (
    <Card title="Verificação em duas etapas" actions={me.user.twoFactorEnabled ? <Pill tone="accent">✓ Ativa</Pill> : <Pill tone="warn">Desativada</Pill>}>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {codes && (
        <Notice tone="success">
          <p className="font-semibold">Guarde estes códigos de backup num lugar seguro. Cada um funciona uma vez, se você perder o celular.</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Notice>
      )}
      {setup ? (
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <p className="text-sm text-ink-2">1. Escaneie com o Google Authenticator, Microsoft Authenticator, 1Password ou similar.</p>
          <img
            alt="QR code para o app autenticador"
            className="size-44 rounded-lg bg-white p-2"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.totpURI, { border: 1 }))}`}
          />
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Não consegue escanear? Digite a chave</summary>
            <code className="mt-2 block break-all text-ink-2">{new URL(setup.totpURI).searchParams.get('secret')}</code>
          </details>
          <Field label="2. Digite o código que aparece no app">
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required autoFocus className="w-40 text-center font-mono tracking-[0.3em]" />
          </Field>
          <div>
            <Button type="submit" loading={verify.isPending}>
              Ativar
            </Button>
          </div>
        </form>
      ) : me.user.twoFactorEnabled ? (
        <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
          <p className="text-sm text-muted">Ao entrar com senha, pedimos o código do app autenticador. O login só por código de e-mail fica bloqueado nesta conta.</p>
          {passwordField}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
              Gerar novos códigos de backup
            </Button>
            <Button variant="danger" onClick={() => disable.mutate()} loading={disable.isPending}>
              Desativar
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          <p className="text-sm text-muted">Protege a conta mesmo que alguém descubra sua senha ou acesse seu e-mail. Obrigatória para dono(a) e administradores.</p>
          {hasPassword.isLoading ? <Loading /> : passwordField}
          <div>
            <Button type="submit" loading={enable.isPending}>
              Configurar app autenticador
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function PasswordCard() {
  const hasPassword = useHasPassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => authCall('/change-password', { currentPassword: current, newPassword: next, revokeOtherSessions: true }),
    onSuccess: () => (setCurrent(''), setNext('')),
  });
  if (hasPassword.isLoading) return null;
  return (
    <Card title="Senha">
      {!hasPassword.data ? (
        <p className="text-sm text-muted">
          Você entra pelo Google ou por código. Para criar uma senha, use <a href="/esqueci-senha" className="text-accent hover:underline">“Esqueci a senha”</a> com o seu e-mail.
        </p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          {change.isError && <Notice tone="error">{errorMessage(change.error)}</Notice>}
          {change.isSuccess && <Notice tone="success">Senha alterada. As outras sessões foram encerradas.</Notice>}
          <Field label="Senha atual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 10 caracteres.">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
          </Field>
          <div>
            <Button type="submit" loading={change.isPending}>
              Trocar senha
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: () => authCall<SessionRow[]>('/list-sessions') });
  const current = useQuery({ queryKey: ['auth', 'current'], queryFn: () => authCall<{ session: { id: string } } | null>('/get-session') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
  const revoke = useMutation({ mutationFn: (token: string) => authCall('/revoke-session', { token }), onSuccess: refresh });
  const revokeOthers = useMutation({ mutationFn: () => authCall('/revoke-other-sessions', {}), onSuccess: refresh });
  return (
    <Card
      title="Sessões ativas"
      actions={
        <Button size="sm" variant="outline" onClick={() => revokeOthers.mutate()} loading={revokeOthers.isPending}>
          Sair dos outros dispositivos
        </Button>
      }
    >
      {sessions.isLoading ? (
        <Loading />
      ) : (
        <ul className="grid gap-2">
          {sessions.data?.map((s) => {
            const isCurrent = s.id === current.data?.session.id;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="text-ink">
                    {device(s.userAgent)} {isCurrent && <Pill tone="accent">este</Pill>}
                  </div>
                  <div className="text-xs text-muted">
                    {s.ipAddress ?? 'IP desconhecido'} · desde {formatDateTime(s.createdAt)}
                  </div>
                </div>
                {!isCurrent && s.token && (
                  <Button size="sm" variant="danger" onClick={() => revoke.mutate(s.token!)}>
                    Encerrar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function DeleteAccountCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPassword = useHasPassword();
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const del = useMutation({
    mutationFn: () => authCall('/delete-user', hasPassword.data ? { password } : {}),
    onSuccess: async () => {
      await signOut().catch(() => undefined);
      qc.clear();
      navigate('/login', { replace: true });
    },
  });
  return (
    <Card title="Excluir minha conta">
      <p className="text-sm text-muted">
        Apaga sua conta, suas conexões bancárias (revogadas também na Pluggy), contas, transações e acessos. Não dá para desfazer. Se você for o único dono(a) de
        uma família com outras pessoas, transfira o papel antes.
      </p>
      {del.isError && (
        <div className="mt-4">
          <Notice tone="error">{errorMessage(del.error)}</Notice>
        </div>
      )}
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          del.mutate();
        }}
      >
        <Field label='Digite "EXCLUIR" para confirmar'>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {hasPassword.data && (
          <Field label="Sua senha">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
        )}
        <div>
          <Button type="submit" variant="danger" disabled={confirm !== 'EXCLUIR'} loading={del.isPending}>
            Excluir conta e dados
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function Security() {
  const { me } = useSession();
  return (
    <>
      <PageHeader eyebrow="Conta" title="Segurança" description={`${me.user.name} · ${me.user.email}`} />
      {me.twoFactorRequired && (
        <Notice tone="warn">Como dono(a) ou administrador(a) da família, você precisa ativar a verificação em duas etapas para continuar usando o app.</Notice>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <TwoFactorCard />
        <SessionsCard />
        <PasswordCard />
        <DeleteAccountCard />
      </div>
    </>
  );
}
