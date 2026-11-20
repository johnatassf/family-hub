import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, Empty, Loading, Notice, PageHeader, Pill, cx, errorMessage, formatDate, formatDateTime } from '@familia/ui';
import { type FinAccount, formatBRL } from '../../shared';
import { financeApi } from '../api';
import { Progress } from '../charts';

/** Limite, fatura em aberto e histórico de faturas do cartão (dados da Pluggy). */
function CardDetails({ account }: { account: FinAccount }) {
  const [open, setOpen] = useState(false);
  const bills = useQuery({ queryKey: ['finance', 'bills', account.id], queryFn: () => financeApi.bills(account.id), enabled: open });
  const limit = account.creditLimitCents;
  const used = limit !== null && account.availableLimitCents !== null ? limit - account.availableLimitCents : null;
  const pct = limit && used !== null ? Math.round((used / limit) * 100) : null;
  return (
    <div className="mt-3 grid gap-2 border-t border-line/70 pt-3 text-xs">
      {limit !== null && used !== null && (
        <div>
          <div className="mb-1 flex justify-between text-ink-2">
            <span>Limite usado {pct !== null && `(${pct}%)`}</span>
            <span className="tabular-nums">
              {formatBRL(used)} de {formatBRL(limit)}
            </span>
          </div>
          <Progress value={used} max={limit} tone={pct !== null && pct > 80 ? 'danger' : pct !== null && pct > 50 ? 'warn' : 'accent'} label="Limite usado" />
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        {account.balanceCents !== null && <span>Em aberto: <b className="text-ink tabular-nums">{formatBRL(account.balanceCents)}</b></span>}
        {account.dueDate && <span>Vence {formatDate(account.dueDate)}</span>}
        {account.minimumPaymentCents !== null && <span>Mínimo {formatBRL(account.minimumPaymentCents)}</span>}
        <button className="text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? 'Ocultar faturas' : 'Ver faturas'}
        </button>
      </div>
      {open &&
        (bills.isLoading ? (
          <Loading />
        ) : bills.data?.length ? (
          <ul className="grid gap-1">
            {bills.data.map((b) => (
              <li key={b.id} className="flex justify-between border-b border-line/50 py-1 text-ink-2">
                <span>Vencimento {formatDate(b.dueDate)}</span>
                <span className="tabular-nums text-ink">{formatBRL(b.totalCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted">Sem faturas sincronizadas ainda. Sincronize a conexão.</span>
        ))}
    </div>
  );
}

const kind = (a: FinAccount) => (a.type === 'CREDIT' ? 'Cartão de crédito' : a.subtype === 'SAVINGS_ACCOUNT' ? 'Poupança' : 'Conta corrente');

function ShareToggle({ account }: { account: FinAccount }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (visibility: 'private' | 'family') => financeApi.updateAccount(account.id, { visibility }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });
  const shared = account.visibility === 'family';
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        role="switch"
        aria-checked={shared}
        aria-label={`Compartilhar ${account.nickname || account.name} com a família`}
        disabled={m.isPending}
        onClick={() => m.mutate(shared ? 'private' : 'family')}
        className={cx(
          'relative h-6 w-11 rounded-full transition disabled:opacity-60',
          shared ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white transition-all', shared ? 'left-[22px]' : 'left-0.5')} />
      </button>
      <span className="text-[11px] text-muted">{shared ? 'Família vê' : 'Só você vê'}</span>
      {m.isError && <span className="text-[11px] text-danger">{errorMessage(m.error)}</span>}
    </div>
  );
}

function Nickname({ account }: { account: FinAccount }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (nickname: string) => financeApi.updateAccount(account.id, { nickname: nickname || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finance'] }),
  });
  return (
    <input
      aria-label="Apelido da conta"
      defaultValue={account.nickname || account.name || ''}
      title="Clique para dar um apelido"
      maxLength={60}
      onBlur={(e) => {
        const v = e.target.value.trim();
        const current = account.nickname || account.name || '';
        // Voltar ao nome original (ou apagar) remove o apelido.
        if (v !== current) m.mutate(v === account.name ? '' : v);
      }}
      className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink hover:border-line-strong focus:border-accent focus:outline-none"
    />
  );
}

function AccountRow({ account }: { account: FinAccount }) {
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card-2/40 p-4">
      <div className="min-w-0 flex-1">
        {account.isMine ? <Nickname account={account} /> : <div className="text-sm font-semibold text-ink">{account.nickname || account.name}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{kind(account)}</span>
          {account.number && <span>•{account.number.slice(-4)}</span>}
          <span>· {account.transactions} lançamentos</span>
          <span>· atualizado {formatDateTime(account.lastSyncAt)}</span>
          {!account.isMine && <Pill>de {account.ownerName}</Pill>}
        </div>
      </div>
      {account.isMine ? <ShareToggle account={account} /> : <Pill tone="accent">Compartilhada</Pill>}
      {account.type === 'CREDIT' ? (
        <div className="basis-full">
          <CardDetails account={account} />
        </div>
      ) : (
        account.balanceCents !== null && (
          <div className="basis-full border-t border-line/70 pt-3 text-xs text-muted">
            Saldo: <b className="text-ink tabular-nums">{formatBRL(account.balanceCents)}</b>
          </div>
        )
      )}
    </li>
  );
}

export function Accounts() {
  const q = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts });
  const mine = q.data?.filter((a) => a.isMine) ?? [];
  const shared = q.data?.filter((a) => !a.isMine) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Contas e cartões"
        description="Toda conta nasce privada. Ligue o compartilhamento para a família acompanhar os gastos de um cartão usado por várias pessoas."
      />
      {q.isError && <Notice tone="error">{errorMessage(q.error)}</Notice>}
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Minhas contas">
            {mine.length ? (
              <ul className="grid gap-3">{mine.map((a) => <AccountRow key={a.id} account={a} />)}</ul>
            ) : (
              <Empty>Nenhuma conta ainda. Cadastre uma conexão em “Conexões” e sincronize.</Empty>
            )}
          </Card>
          <Card title="Compartilhadas comigo">
            {shared.length ? (
              <ul className="grid gap-3">{shared.map((a) => <AccountRow key={a.id} account={a} />)}</ul>
            ) : (
              <Empty>Ninguém da família compartilhou contas ainda.</Empty>
            )}
            <p className="mt-4 text-xs text-muted">Contas privadas de outras pessoas nunca aparecem aqui, nem para o dono(a) da família.</p>
          </Card>
        </div>
      )}
    </>
  );
}
