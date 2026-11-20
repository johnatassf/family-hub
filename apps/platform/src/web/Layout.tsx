import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { type HouseholdSummary, type Me, ROLE_LABEL } from '@familia/shared';
import { ApiError, Loading, SessionContext, apiFetch, cx, getActiveHousehold, onApiError, setActiveHousehold } from '@familia/ui';
import { signOut } from './lib/auth';
import { usePublicConfig } from './lib/config';
import { InstallBanner } from './lib/install';
import { webModules } from './modules';
import { AuthShell } from './pages/AuthShell';

const fetchMe = () =>
  apiFetch<Me>('/api/me').catch((e) => {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  });

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
    isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-card-2 hover:text-ink',
  );

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
  /** Só fica ativo no caminho exato (a página inicial de cada área). */
  end?: boolean;
}

interface NavGroup {
  id: string;
  title: string;
  items: NavEntry[];
}

/** Grupos do menu: uma área por módulo + "Conta". Com 2FA pendente, só a Segurança aparece. */
function navGroups(me: Me): NavGroup[] {
  const groups: NavGroup[] = me.twoFactorRequired
    ? []
    : webModules.map((m) => ({
        id: m.id,
        title: m.title,
        items: m.nav.map((n) => ({ to: `/${m.basePath}${n.to ? `/${n.to}` : ''}`, label: n.label, icon: n.icon, end: n.to === '' })),
      }));
  groups.push({
    id: 'conta',
    title: 'Conta',
    items: [...(me.twoFactorRequired ? [] : [{ to: '/familia', label: 'Família', icon: '⌂' }]), { to: '/seguranca', label: 'Segurança', icon: '⚿' }],
  });
  return groups;
}

const matches = (item: NavEntry, path: string) => path === item.to || (!item.end && path.startsWith(`${item.to}/`));
const inGroup = (g: NavGroup, path: string) => g.items.some((i) => path === i.to || path.startsWith(`${i.to}/`));

/** Item do menu da página atual (o caminho mais específico), para o título da barra do celular. */
function currentItem(groups: NavGroup[], path: string) {
  return groups
    .flatMap((g) => g.items)
    .filter((i) => matches(i, path))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

/** Menu agrupado: cada área abre e fecha; a área da página atual abre sozinha. */
function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const { pathname } = useLocation();
  const active = groups.find((g) => inGroup(g, pathname))?.id;
  const [open, setOpen] = useState<Set<string>>(() => new Set(active ? [active] : []));

  useEffect(() => {
    if (active) setOpen((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label="Menu principal" className="grid gap-1">
      {groups.map((g) => {
        const expanded = groups.length === 1 || open.has(g.id);
        return (
          <div key={g.id}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              aria-expanded={expanded}
              aria-controls={`menu-${g.id}`}
              className={cx(
                'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[11px] font-semibold tracking-wider uppercase transition hover:bg-card-2',
                g.id === active ? 'text-ink' : 'text-muted',
              )}
            >
              <span className="truncate">{g.title}</span>
              <span aria-hidden className={cx('text-sm leading-none transition-transform', expanded && 'rotate-90')}>
                ›
              </span>
            </button>
            {expanded && (
              <div id={`menu-${g.id}`} className="mt-0.5 mb-2 grid gap-0.5">
                {g.items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.end} className={linkClass}>
                    <span aria-hidden className="w-4 text-center">
                      {i.icon}
                    </span>
                    {i.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Conteúdo do menu lateral: igual no computador (fixo) e no celular (gaveta). */
function Sidebar(props: {
  me: Me;
  household: HouseholdSummary;
  groups: NavGroup[];
  onSwitchHousehold: (id: string) => void;
  onLogout: () => void;
  onClose?: () => void;
}) {
  const { me, household, groups, onSwitchHousehold, onLogout, onClose } = props;
  const config = usePublicConfig();
  return (
    <>
      <div className="flex items-start justify-between gap-2 px-5 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <div className="text-lg text-accent">
            ◈ <b>{config.data?.appName ?? 'Família'}</b>
          </div>
          {me.households.length > 1 ? (
            <select
              aria-label="Família ativa"
              value={household.id}
              onChange={(e) => onSwitchHousehold(e.target.value)}
              className="mt-2 w-full rounded-md border border-line-strong bg-page px-2 py-1 text-xs text-ink-2"
            >
              {me.households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1 truncate text-xs text-muted">{household.name}</div>
          )}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar menu" className="-mr-2 rounded-lg p-2 leading-none text-muted hover:bg-card-2 hover:text-ink">
            ✕
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <SidebarNav groups={groups} />
      </div>
      <div className="border-t border-line px-5 py-4 text-xs">
        <div className="truncate text-ink">{me.user.name}</div>
        <div className="truncate text-muted">{ROLE_LABEL[household.role]}</div>
        <button onClick={onLogout} className="mt-2 text-accent hover:underline">
          Sair
        </button>
      </div>
    </>
  );
}

/** Área autenticada: exige sessão, família e (para dono/admin) 2FA ativo. */
export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const config = usePublicConfig();
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 });
  // Menu lateral do celular (gaveta). No computador o menu fica sempre visível.
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Escolheu uma página: fecha a gaveta.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Gaveta aberta: trava a rolagem da página por trás e fecha com Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
    navigate('/');
  };

  const groups = navGroups(data);
  const current = currentItem(groups, location.pathname);
  const sidebarProps = { me: data, household, groups, onSwitchHousehold: switchHousehold, onLogout: logout };

  return (
    <SessionContext.Provider value={{ me: data, household }}>
      <div className="min-h-screen bg-page">
        {/* Computador: menu lateral fixo. */}
        <aside className="hidden border-r border-line bg-side lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60 lg:flex-col">
          <Sidebar {...sidebarProps} />
        </aside>

        {/* Celular: barra no topo com o botão do menu, que abre a gaveta lateral. */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-side px-2 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
            aria-controls="menu-celular"
            className="rounded-lg px-3 py-2 text-xl leading-none text-ink hover:bg-card-2"
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{current?.label ?? config.data?.appName ?? 'Família'}</div>
            <div className="truncate text-xs text-muted">{household.name}</div>
          </div>
          <span aria-hidden className="px-3 text-lg text-accent">
            ◈
          </span>
        </header>
        <div
          aria-hidden
          onClick={() => setMenuOpen(false)}
          className={cx('fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden', menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
        />
        <aside
          id="menu-celular"
          aria-label="Menu"
          inert={!menuOpen}
          className={cx(
            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-side shadow-2xl transition-transform duration-200 lg:hidden',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar {...sidebarProps} onClose={() => setMenuOpen(false)} />
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-8 lg:ml-60 lg:py-10">
          <div className="mx-auto max-w-[1500px]">
            <InstallBanner className="mb-6" />
            <Outlet />
          </div>
          <footer className="mx-auto mt-10 max-w-[1500px] text-xs text-muted">Dados protegidos · acesso por convite</footer>
        </main>
      </div>
    </SessionContext.Provider>
  );
}
