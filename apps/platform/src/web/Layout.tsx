import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { type Me, ROLE_LABEL } from '@familia/shared';
import { ApiError, Loading, SessionContext, apiFetch, cx, getActiveHousehold, onApiError, setActiveHousehold } from '@familia/ui';
import { signOut } from './lib/auth';
import { usePublicConfig } from './lib/config';
import { webModules } from './modules';
import { AuthShell } from './pages/AuthShell';

const fetchMe = () =>
  apiFetch<Me>('/api/me').catch((e) => {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  });

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition whitespace-nowrap',
    isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-card-2 hover:text-ink',
  );

/** Área autenticada: exige sessão, família e (para dono/admin) 2FA ativo. */
export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const config = usePublicConfig();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 });

  useEffect(
    () =>
      onApiError((e) => {
        if (e.status === 401) qc.setQueryData(['me'], null);
        if (e.code === 'TWO_FACTOR_REQUIRED') {
          qc.invalidateQueries({ queryKey: ['me'] });
          navigate('/seguranca');
        }
        if (e.code === 'NO_HOUSEHOLD') {
          setActiveHousehold(null);
          qc.invalidateQueries({ queryKey: ['me'] });
        }
      }),
    [qc, navigate],
  );

  if (me.isLoading) return <Loading label="Abrindo…" />;
  if (me.isError) return <AuthShell title="Não foi possível carregar">Tente recarregar a página.</AuthShell>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  const data = me.data;
  const logout = async () => {
    await signOut().catch(() => undefined);
    setActiveHousehold(null);
    qc.clear();
    navigate('/login', { replace: true });
  };

  if (!data.households.length) {
    return (
      <AuthShell title="Aguardando convite" subtitle={`Você entrou como ${data.user.email}.`}>
        <p className="text-sm text-ink-2">Sua conta ainda não participa de nenhuma família. Peça para alguém da família enviar um convite para este e-mail.</p>
        <button onClick={logout} className="mt-6 text-sm text-accent hover:underline">
          Sair
        </button>
      </AuthShell>
    );
  }

  const stored = getActiveHousehold();
  const household = data.households.find((h) => h.id === stored) ?? data.households[0]!;
  if (household.id !== stored) setActiveHousehold(household.id);

  if (data.twoFactorRequired && location.pathname !== '/seguranca') return <Navigate to="/seguranca" replace />;

  const switchHousehold = (id: string) => {
    setActiveHousehold(id);
    qc.resetQueries();
    navigate('/');
  };

  return (
    <SessionContext.Provider value={{ me: data, household }}>
      <div className="min-h-screen bg-page lg:flex">
        <aside className="border-b border-line bg-side lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 lg:block lg:pt-7 lg:pb-6">
            <div className="text-lg text-accent">
              ◈ <b>{config.data?.appName ?? 'Família'}</b>
            </div>
            {data.households.length > 1 ? (
              <select
                aria-label="Família ativa"
                value={household.id}
                onChange={(e) => switchHousehold(e.target.value)}
                className="mt-0 max-w-40 rounded-md border border-line-strong bg-page px-2 py-1 text-xs text-ink-2 lg:mt-2 lg:w-full lg:max-w-none"
              >
                {data.households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-muted lg:mt-1">{household.name}</div>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {!data.twoFactorRequired &&
              webModules.map((m) => (
                <div key={m.id} className="contents lg:mb-4 lg:block">
                  <div className="hidden px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase lg:block">{m.title}</div>
                  {m.nav.map((n) => (
                    <NavLink key={n.to} to={`/${m.basePath}${n.to ? `/${n.to}` : ''}`} end={n.to === ''} className={linkClass}>
                      <span aria-hidden className="w-4 text-center">
                        {n.icon}
                      </span>
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            <div className="contents lg:block">
              <div className="hidden px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase lg:block">Conta</div>
              {!data.twoFactorRequired && (
                <NavLink to="/familia" className={linkClass}>
                  <span aria-hidden className="w-4 text-center">⌂</span>Família
                </NavLink>
              )}
              <NavLink to="/seguranca" className={linkClass}>
                <span aria-hidden className="w-4 text-center">⚿</span>Segurança
              </NavLink>
            </div>
          </nav>
          <div className="hidden border-t border-line px-5 py-4 text-xs lg:block">
            <div className="truncate text-ink">{data.user.name}</div>
            <div className="truncate text-muted">{ROLE_LABEL[household.role]}</div>
            <button onClick={logout} className="mt-2 text-accent hover:underline">
              Sair
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:ml-60 lg:py-10">
          <div className="mx-auto max-w-[1500px]">
            <Outlet />
          </div>
          <footer className="mx-auto mt-10 flex max-w-[1500px] justify-between text-xs text-muted">
            <span>Dados protegidos · acesso por convite</span>
            <button onClick={logout} className="text-accent hover:underline lg:hidden">
              Sair
            </button>
          </footer>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
