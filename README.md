# Família — plataforma familiar com módulos (Cloudflare)

Plataforma web para famílias organizarem a vida em conjunto, em duas áreas: **Finanças da família** e **Empresa** (o controle do negócio de cada um). Nas finanças, cada pessoa conecta os próprios bancos e cartões pela [Pluggy](https://pluggy.ai), as contas nascem **privadas** e o dono decide compartilhar com a família — útil para acompanhar cartões usados por várias pessoas e indicar **quem gastou** cada compra.

Substitui o protótipo Flask em `../financeiro-pluggy` (mantido como referência).

## Situação atual (20/11/2026)

| | |
|---|---|
| Endereço | https://familia-hub.hub-family.workers.dev |
| Plano | Cloudflare **Workers Free**: sem cartão cadastrado, nada é cobrado. Ao passar de um limite, o recurso para até o limite zerar. |
| No ar | Worker `familia-hub` (API + React), banco D1 com as 6 migrations, KV, login com Google, e-mail pelo Brevo, segredos da Pluggy |
| Falta | Primeiro acesso do dono (entrar com Google e ativar o 2FA) e convidar a família |
| Staging | Não criado (bloco `staging` do `wrangler.jsonc` ainda com `SUBSTITUIR_...`) |
| Git / GitHub | Sem commits nem repositório remoto: os workflows de `.github/` ainda não rodam |

## Inventário técnico

Tudo o que a aplicação usa hoje, para análise de custo, risco e melhorias.

### Infraestrutura na Cloudflare

| Recurso | Identificação | Para que serve | Limite no plano grátis |
|---|---|---|---|
| **Worker** | `familia-hub` (ambiente `production`) | Um único Worker serve a API (`/api/*`) e o React | 100 mil requisições/dia; **10 ms de CPU** por requisição; 50 chamadas externas (`fetch`) por requisição; 3 MB de código comprimido (hoje 409 KB) |
| **Static Assets** | build do Vite (`dist/client`) | HTML/JS/CSS do React. Só `/api/*` passa pelo Worker (`run_worker_first`); o resto é SPA | Grátis, não conta como requisição do Worker |
| **D1** (SQLite gerenciado) | `familia-hub` · `eec1f6f5-41fd-4013-9bb1-9ab6e4a18682` · região **ENAM** (leste dos EUA) | Banco de tudo: login, famílias, finanças, planejamento, loja | 500 MB por banco (5 GB na conta); 5 milhões de linhas lidas/dia; 100 mil gravadas/dia; zera às 00:00 UTC (21h em Brasília) |
| **KV** | `47f5e16aedbd4fc6bb8f96807cd78310` (binding `KV`) | Cache da chave de API da Pluggy (~100 min). Em dev, caixa de saída dos e-mails | 100 mil leituras/dia; 1 mil gravações/dia |
| **Rate Limiting** | `RL_AUTH`: 10/min por IP nas rotas de login · `RL_API`: 120/min por usuário (ou IP) no resto da API | Proteção contra abuso | Incluído |
| **Cron Trigger** | `0 9 * * *` (06:00 em Brasília) | Sincronização diária das conexões Pluggy | Mesmo limite de CPU e de chamadas externas do Worker |
| **Observability** | Logs ligados | `npx wrangler tail --env production` e painel da Cloudflare | Cota diária de logs do plano |
| **workers.dev** | Subdomínio `hub-family` | Endereço público sem domínio próprio | Grátis |
| Email Service (`send_email`) | Não usado em produção | Alternativa de e-mail quando houver domínio | Só no Workers Paid |
| Turnstile | Não configurado | Captcha nos formulários de login | Grátis |
| Zero Trust Access | Não configurado | Proteger um ambiente de staging | Grátis até 50 usuários |

Limites oficiais: [Workers](https://developers.cloudflare.com/workers/platform/limits/) · [D1](https://developers.cloudflare.com/d1/platform/pricing/) · [KV](https://developers.cloudflare.com/kv/platform/limits/).

### Serviços externos

| Serviço | Uso no app | Plano / custo | Situação |
|---|---|---|---|
| **Pluggy** (API v2) | Contas, cartões, limites, faturas e transações (`/v2/transactions` com cursor, `createdAtFrom` e `ids`) | Meu Pluggy: grátis **só para uso pessoal**; várias pessoas exigem contrato comercial | Credenciais configuradas |
| **Google OAuth** | Login com Google — a forma de entrar na produção atual | Grátis. Em modo "Teste", só entram os e-mails cadastrados como usuários de teste | Configurado (projeto `Familia Hub` no Google Cloud) |
| **Brevo** (API transacional) | Códigos de login e convites por e-mail | Grátis: 300 e-mails/dia | Configurado. Remetente verificado é um Gmail, que o Brevo reescreve para `...@<id>.brevosend.com` |
| Resend | Alternativa de e-mail já suportada (`RESEND_API_KEY`) | Grátis: 100/dia e 3 mil/mês; exige domínio próprio | Não usado |

### Bibliotecas e ferramentas (versões instaladas)

**Servidor (Worker)**

| Pacote | Versão | Papel |
|---|---|---|
| `hono` | 4.13.19 | Rotas e middlewares da API |
| `zod` | 4.6.7 | Validação de toda entrada da API |
| `better-auth` | 1.7.27 | Login (Google, código por e-mail, senha), sessões, 2FA (app autenticador ou código por e-mail), rate limit por rota. Plugins: `emailOTP`, `twoFactor`, `captcha` (Turnstile) |
| D1 sem ORM | — | SQL parametrizado escrito à mão, via binding `DB` |

**Frontend (React)**

| Pacote | Versão | Papel |
|---|---|---|
| `react` / `react-dom` | 19.3.1 | Interface |
| `react-router` | 8.5.2 | Rotas das telas |
| `@tanstack/react-query` | 5.108.2 | Chamadas à API e cache |
| `recharts` | 3.11.0 | Gráficos |
| `tailwindcss` | 4.3.5 | Estilos |
| `uqr` | 0.1.3 | QR code para ativar o 2FA |

**PWA (app instalável no celular e no computador)** — sem biblioteca extra:

| Arquivo | Papel |
|---|---|
| `public/manifest.webmanifest` | Nome, cores, tela cheia (`standalone`) e ícones |
| `public/icons/` | Ícones 192/512 px, versão *maskable* (Android) e `apple-touch-icon` (iPhone) |
| `public/sw.js` | Service worker mínimo: só mostra `/offline` sem internet. **Não guarda dados da API nem o código do app** (dados financeiros não ficam no aparelho e cada publicação vale na hora) |
| `src/web/lib/install.tsx` | Registra o service worker e mostra o aviso "Instale o app": botão **Instalar** no Android/Chrome/Edge; no iPhone, instrução *Compartilhar → Adicionar à Tela de Início* (o Safari não permite botão) |

O app instalado funciona só com internet; sem conexão aparece a página `/offline`. Notificações push e uso offline com dados não estão implementados.

**Build, testes e ferramentas**

| Ferramenta | Versão | Papel |
|---|---|---|
| `vite` + `@vitejs/plugin-react` | 8.3.8 / 6.3.0 | Dev server e build do React |
| `@cloudflare/vite-plugin` | 1.70.1 | Roda o Worker dentro do Vite no dev e gera o build do Worker |
| `wrangler` | 4.165.0 | CLI da Cloudflare: deploy, D1, KV, segredos, logs |
| `typescript` | 7.0.2 | Tipagem (Worker, React e configs) |
| `@cloudflare/workers-types` | 5.20261120.1 | Tipos do runtime do Workers |
| `vitest` + `@cloudflare/vitest-plugin` | 4.1.12 / 1.8.5 | Testes rodando no runtime do Workers, com D1 e KV locais |
| Node.js | 20+ (CI usa 22) | Ambiente de desenvolvimento |
| Python 3 + `openpyxl` | — | Só o script de importação da planilha da loja |

### Banco de dados (D1)

| Migration | Tabelas |
|---|---|
| `0001_auth` | `user`, `session`, `account`, `verification`, `twoFactor`, `rateLimit` (gerada pelo Better Auth) |
| `0002_core` | `households`, `household_members`, `invites`, `audit_log` |
| `0003_finance` | `fin_items`, `fin_accounts`, `fin_transactions`, `fin_categories`, `fin_category_rules`, `fin_sync_runs` |
| `0004_planning` | `fin_bills`, `plan_entries`, `plan_settings`, `goals`, `goal_contributions`, `goal_items` (+ limite e fatura em `fin_accounts`) |
| `0005_store` | `biz_businesses`, `biz_members`, `biz_products`, `biz_kit_items`, `biz_customers`, `biz_sales`, `biz_sale_items`, `biz_payments`, `biz_stock_moves`, `biz_payables` |
| `0006_incremental_sync` | Coluna `fin_accounts.tx_synced_at` e índice das transações pendentes |
| `0007_card_bill_month` | Cartões no mês da fatura (`plan_settings.card_month`, `fin_transactions.reference_month_manual`) e correção dos pagamentos de fatura que contavam como gasto |

Toda tabela de dados tem `household_id` (ou `business_id` na loja) e toda consulta passa pela regra de acesso do módulo.

### Variáveis e segredos

**Variáveis** (públicas, no `wrangler.jsonc`):

| Nome | Produção | Para que serve |
|---|---|---|
| `APP_NAME` | `Família` | Nome no app e nos e-mails |
| `APP_URL` | `https://familia-hub.hub-family.workers.dev` | Endereço exato do app: o login e a checagem de CSRF comparam com ele |
| `EMAIL_FROM` | `Família <remetente verificado no Brevo>` | Remetente dos e-mails (tem que ser o verificado no Brevo) |
| `REQUIRE_ADMIN_2FA` | `true` | Dono/admin precisam de 2FA |
| `ALLOW_OPEN_SIGNUP` | `false` | Cadastro só por convite |
| `FINANCE_MEMBERS_CAN_CONNECT` | `false` | Só dono/admin cadastram conexões Pluggy |
| `DEV_EMAIL_OUTBOX` | `false` | Em dev, mostra o e-mail no terminal em vez de enviar |

**Segredos** (só na Cloudflare via `wrangler secret`, ou no `.dev.vars` local; nunca no git):

| Nome | Produção | Para que serve |
|---|---|---|
| `BETTER_AUTH_SECRET` | ✅ | Assina sessões e cookies |
| `BOOTSTRAP_OWNER_EMAILS` | ✅ (conta Google do dono) | Quem pode criar a primeira família sem convite |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | ✅ | Acesso à API da Pluggy |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | Login com Google |
| `BREVO_API_KEY` | ✅ | Envio de e-mail (chave "API key" `xkeysib-`, não a SMTP) |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — (opcional) | Captcha nos formulários |
| `RESEND_API_KEY` | — (alternativa) | Envio de e-mail pelo Resend |

Ordem dos provedores de e-mail: binding `EMAIL` (Cloudflare) → Resend → Brevo; usa o primeiro configurado.

### Código e entrega

- **Monorepo** com npm workspaces: `apps/platform` (o Worker) e `packages/*` (módulos). TypeScript em tudo.
- **Build atual:** 1,86 MB (409 KB com gzip); o Worker inicia em 32 ms.
- **CI/CD** (GitHub Actions; repositório público, então os minutos são grátis): `ci.yml` roda typecheck, testes e build em todo PR e push na `main`. `deploy.yml` é só manual (*Run workflow*): aplica as migrations e publica no ambiente escolhido, e precisa dos *secrets* `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`. Hoje a publicação é feita do computador com `npm run deploy:production`.
- **Testes:** Vitest no runtime do Workers cobrindo login, regras de acesso, sincronização (contra uma Pluggy falsa), paridade com o Python, planejamento, loja e envio de e-mail.

## Pontos de atenção e oportunidades de melhoria

**Limites do plano grátis**
- **10 ms de CPU por requisição.** O login com senha (hash scrypt) e a primeira sincronização de uma conta (histórico inteiro) podem estourar, com erro 1102. Por isso a produção usa login pelo Google. Saídas: Workers Paid (US$ 5/mês) ou dividir a primeira sincronização em várias requisições.
- **50 chamadas externas por requisição.** Cada conexão Pluggy usa ~5 a 10 chamadas (autenticação, item, contas, faturas por cartão, páginas de transações). O cron sincroniza até 25 conexões de uma vez: com muitas conexões, estoura. Reduzir o lote no plano grátis ou ir para o Paid.
- **Importação da planilha da loja** (`importar-planilha-loja.py`) entra com e-mail e senha, o que esbarra no limite de CPU e no login só pelo Google. A importação pela tela (já no backlog) resolve.

**E-mail**
- O remetente verificado é um Gmail, e o Brevo não pode assinar pelo domínio `gmail.com`: ele reescreve o endereço para `...@<id>.brevosend.com` (o nome "Família" continua). Funciona, mas parece menos confiável e pode cair no spam. Um domínio próprio (~R$ 40/ano em `.com.br`) com registros SPF/DKIM resolve e libera o Resend ou o Email Service da Cloudflare.
- O Brevo tem bloqueio por IP nas chaves de API. O Worker não tem IP de saída fixo (só no plano Enterprise), então esse bloqueio precisa ficar desligado.

**Desempenho**
- O D1 fica no leste dos EUA (não há região na América do Sul): cada consulta vai do Brasil até lá. Vale avaliar o *Smart Placement* (rodar o Worker perto do banco) e as réplicas de leitura do D1.

**Login e acesso**
- Google OAuth em modo "Teste": só entram os e-mails cadastrados como usuários de teste. Para abrir a mais gente, publicar o app no Google.
- Turnstile não configurado em produção (recomendado contra robôs no login).

**Sincronização**
- Sem webhooks da Pluggy: um lançamento já lançado que mude depois só atualiza com "Buscar tudo", e uma pendente apagada na Pluggy continua no app.
- Uso da Pluggy por várias pessoas depende de contrato (o Meu Pluggy é pessoal).

**Operação**
- Sem ambiente de staging; o deploy pelo GitHub é manual e ainda não tem os *secrets* da Cloudflare.
- Backup: só o histórico de restauração do próprio D1 (*Time Travel*); não há exportação agendada.
- Sem alerta de erro: os logs existem, mas ninguém é avisado quando algo falha.

**Quanto custa sair do grátis**

| Item | Custo | O que libera |
|---|---|---|
| Workers Paid | US$ 5/mês | CPU até 30 s por requisição, muito mais chamadas externas, 3 mil e-mails/mês pelo Email Service, cotas mensais maiores de D1 e KV |
| Domínio próprio | ~R$ 40/ano (`.com.br`) | E-mail fora do spam, endereço próprio, Email Service ou Resend |
| Pluggy comercial | sob consulta | Várias pessoas conectando os próprios bancos (Pluggy Connect + webhooks) |

## Estrutura

```
apps/platform/            o único Worker: API (src/worker) + React (src/web)
  migrations/             SQL do D1 (0001 a 0007, ver "Banco de dados")
  test/                   testes (login, acesso, sincronização, paridade com o Python, loja, e-mail)
  wrangler.jsonc          bindings: dev local, staging e produção
packages/core/            login, famílias, convites, papéis, auditoria, rate limit, headers, e-mail
packages/finance/         Finanças da família: server/ (Pluggy, sync, planejamento) e web/ (telas)
packages/store/           Empresa · Loja de presentes: server/ (vendas, estoque, kits, fiado, boletos) e web/
packages/shared/          tipos compartilhados front/back
packages/ui/              componentes e cliente da API do frontend
```

### Como entra um módulo novo
1. Crie `packages/<modulo>` com `server/` (exporta `{ id, basePath, routes, hooks, scheduled }`) e `web/` (exporta um `WebModule` com menu e rotas).
2. Registre no Worker: `apps/platform/src/worker/index.ts` (lista `modules`).
3. Registre no React: `apps/platform/src/web/modules.ts`.
4. Adicione a migration em `apps/platform/migrations/` com `household_id` em toda tabela.

As regras de negócio ficam em `service.ts` recebendo um `RequestCtx` já autorizado — assim um servidor MCP no futuro reaproveita a mesma lógica sem duplicar regra de acesso.

## Rodando localmente

Requer Node 20+.

```bash
npm install
cp apps/platform/.dev.vars.example apps/platform/.dev.vars   # preencha os valores
npm run db:migrate:local
npm run dev                                                  # http://localhost:5173
```

- Em dev, os e-mails **não são enviados**: o código aparece no terminal (`[dev-email] ... Seu código é 123456`). Para testar o envio real pelo Brevo, veja o `.dev.vars.example`.
- O primeiro acesso só funciona para e-mails em `BOOTSTRAP_OWNER_EMAILS`; essa pessoa vira dona da família e convida as outras pela tela **Família**.
- Dono(a) e administradores precisam ativar 2FA antes de usar o app.

```bash
npm test            # testes no runtime do Workers
npm run typecheck   # Worker, React e configs
npm run build
```

## Publicação (produção)

A conta, o banco, o KV e os segredos já estão configurados. Para publicar uma nova versão:

```bash
cd apps/platform
npm run db:migrate:production   # só quando houver migration nova
npm run deploy:production       # build do React + Worker e publicação
npx wrangler tail --env production   # logs ao vivo
```

Segredos: `npx wrangler secret list --env production` mostra os nomes; `npx wrangler secret put NOME --env production` cadastra ou troca (o valor não aparece na tela).

**Como o login e o e-mail foram configurados** (para refazer ou trocar credenciais):
1. **Google Cloud Console** (projeto `Familia Hub`): tela de consentimento *Externo* (com os usuários de teste) e um ID do cliente OAuth do tipo *Aplicativo da Web* com:
   - origem JavaScript `https://familia-hub.hub-family.workers.dev`
   - URI de redirecionamento `https://familia-hub.hub-family.workers.dev/api/auth/callback/google`

   Credenciais em `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (`npx wrangler secret put ... --env production`; o `secret put` já publica).
2. **Brevo:** chave em *Configurações → SMTP e API → Chaves de API e MCP* (`BREVO_API_KEY`), remetente verificado em *Remetentes, domínios e IPs* (vai no `EMAIL_FROM` do `wrangler.jsonc`, e mudar exige `npm run deploy:production`). Bloqueio de IP desligado.
3. Para usar o login com Google também no dev local, adicione `http://localhost:5173` e `http://localhost:5173/api/auth/callback/google` no mesmo cliente OAuth e as duas credenciais no `.dev.vars`.

**Staging (opcional):** criar `familia-hub-staging` (D1) e um KV com `--env staging`, preencher o bloco `staging` do `wrangler.jsonc`, cadastrar os mesmos segredos com `--env staging` e rodar `npm run db:migrate:staging && npm run deploy:staging`. Proteja com *Zero Trust → Access*.

**Com o GitHub:** cadastre `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` nos *secrets* do repositório para os workflows de CI e deploy funcionarem.

## Planejamento financeiro

| Tela | O que faz | De onde vêm os dados |
|---|---|---|
| **Parcelas** | Compras parceladas em aberto, quanto falta, quando termina e o compromisso de cada mês (12 meses), separando parcelas lançadas pelo banco e **previstas pelo app** (bancos que só lançam a parcela do mês). Mostra quando o orçamento libera. | Pluggy (`creditCardMetadata`: parcela n/N e data da compra) |
| **Contas e cartões** | Limite usado/disponível, valor em aberto, vencimento, mínimo e histórico de faturas. | Pluggy (`creditData`, `/bills`) |
| **Planejamento** | Projeção de 12 meses: renda → fixos, parcelas, dia a dia, metas e o que sobra; % da renda comprometida contra um limite saudável (padrão 30%); saldo previsto; simulador **“Cabe no orçamento?”** que sugere outro mês ou número de parcelas. | Rendas e fixos cadastrados (com sugestões detectadas nas contas) + parcelas + média de gastos |
| **Metas** | Compras, viagens (com orçamento por item) e reserva: quanto guardar por mês até a data, aportes de quem participa. Entra na projeção. | Cadastradas pela família |

Privacidade: a visão **Família** só usa contas, rendas e metas compartilhadas; a visão **Só eu** usa as da própria pessoa. Os cálculos ficam em `packages/finance/src/planning.ts` (funções puras, testadas isoladamente).

## Empresa · Loja de presentes

Controle da loja da Larissa (revenda Natura, O Boticário, Avon, Jequiti, Eudora e kits/cestas montados por ela). **Os dados da empresa são privados**: só a dona e quem ela der acesso (pode editar / só visualiza) veem — nem a família vê por padrão.

| Tela | O que faz |
|---|---|
| **Painel da loja** | Vendas e ticket médio do mês, lucro bruto (preço − custo), fiado a receber (e vencido), boletos dos próximos 30 dias, caixa previsto (a receber × a pagar), mais vendidos, estoque baixo, aniversariantes com mensagem pronta no WhatsApp. |
| **Vender** | PDV: busca de produtos e kits, item avulso, quantidade e preço editáveis, desconto, cliente (cadastro rápido), Dinheiro/Pix/Débito/Crédito/**Fiado** com data combinada; recibo para copiar ou enviar no WhatsApp. A venda baixa o estoque (o kit baixa os componentes). |
| **Vendas** | Vendas do mês; cancelar devolve ao estoque. |
| **A receber (fiado)** | Vendas a prazo em aberto, vencidas primeiro; recebimento parcial; botão “Cobrar no WhatsApp”. |
| **Clientes** | Quanto já comprou, quanto deve, última compra, aniversário, histórico. |
| **Produtos e kits** | Produtos (custo, preço, margem, estoque, mínimo), **kits/cestas** montados com produtos + insumos (custo calculado, preço sugerido para 40% de margem, “dá para montar N”), insumos (caixas, laços). Entrada de mercadoria recalcula o custo médio. |
| **Boletos** | Boletos dos pedidos às marcas, parcelados por mês; marcação de **compartilhado**; pagar com valor diferente (desconto). |
| **Acesso** | A dona escolhe quem da família ajuda ou só visualiza. |

**Importar a planilha atual** (abas “Contas a Pagar”, “Boletos compartilhados”, “Compras Clientes”, “Cliente”):

```bash
pip install openpyxl
python apps/platform/scripts/importar-planilha-loja.py "Trabalho 2026.xlsx" --email <e-mail> --senha <senha> [--codigo <2FA>] [--loja "Larissa — Loja de presentes"]
```

O servidor interpreta as abas (`packages/store/src/import.ts`, com testes): junta boletos repetidos entre as abas (marca “A confirmar” casa por data e valor), mantém separados boletos idênticos da mesma aba, transforma o fiado em vendas em aberto com os itens e o que já foi pago, não duplica a venda que está no registro e no fiado, e monta o catálogo inicial reconhecendo a marca pela descrição. Só roda numa loja vazia.

**Backlog da área Empresa:** controle da empresa do Jonatas; importar a planilha direto pela tela; campanhas/ciclos das marcas; comissão de revenda; lembrete automático de cobrança e aniversário.

## Sincronização com a Pluggy

Incremental, por conta (`packages/finance/src/server/sync.ts`):

- **Primeira vez** (ou conta nova na conexão): busca o histórico inteiro, em páginas de 500.
- **Depois:** busca só o que a Pluggy recebeu desde a última vez (`createdAtFrom`, com 1 dia de margem — pega até lançamento novo com data antiga) e reconsulta pelo id as transações que estavam **pendentes** (fatura aberta, parcelas futuras), que é como chega a mudança de pendente para lançada.
- **Buscar tudo** (tela Conexões, `POST /items/:id/sync?full=1`): refaz o histórico inteiro. Serve para o caso raro de um lançamento já lançado mudar na Pluggy.
- Edições manuais (categoria, mês, quem gastou, exclusão) nunca são sobrescritas. Se a busca de uma conta falhar no meio, ela recomeça do ponto anterior na próxima vez.

Com os webhooks da Pluggy (`transactions/created`, `/updated`, `/deleted`), a reconsulta das pendentes pode ser trocada pelos ids que a própria Pluggy avisa.

## Segurança — o que já está implementado

- **Acesso por convite:** cadastro fechado; o convite é preso ao e-mail e só vale com o e-mail comprovado. A resposta do cadastro não revela quem tem convite.
- **2FA obrigatório** para dono(a)/admin, por **app autenticador** (com códigos de backup) ou, para quem não tem celular, por **código no e-mail** (menos seguro: quem acessa o e-mail passa pela etapa). Quem configurou o app não recebe a segunda etapa por e-mail. Quem tem 2FA não entra só com código de e-mail (seria um rebaixamento de segurança). O 2FA é cobrado no login com senha; o login com Google confia na segurança da conta Google.
- **Privacidade entre familiares:** toda consulta passa por uma única regra (`packages/finance/src/server/access.ts`); nem o dono da família vê conta privada de outra pessoa. Só o dono da conta edita os lançamentos dela.
- **Proteção de itemId:** conferido na Pluggy antes de salvar; um item só tem um dono na plataforma.
- **Rate limit em duas camadas** (binding do Workers por IP/usuário + Better Auth por endpoint), **Turnstile** nos formulários (quando configurado), trava de 5 min por sincronização.
- **CSRF** (checagem de `Origin`), cookies `HttpOnly`/`Secure`/`SameSite=Lax`, **CSP** restrita e demais headers (`public/_headers` e API), validação zod em toda rota, CSV protegido contra injeção de fórmula.
- **Auditoria** de logins, convites, papéis, compartilhamentos, sincronizações e exportações.
- **LGPD:** excluir a conta apaga os dados e revoga as conexões na Pluggy; sair da família leva os dados da pessoa junto.
- Segredos só no servidor (`wrangler secret` / `.dev.vars`), nunca no bundle do navegador. Erros dos provedores (Pluggy, e-mail) vão só para o log; a tela recebe mensagem genérica.

## Diferenças em relação ao app Flask (intencionais)

A sincronização foi comparada transação a transação com o `sync()` do Python sobre os mesmos dados reais: mesmos IDs, datas, meses, parcelas e categorias. Duas correções mudam os totais:

1. **Sinal dos valores:** no cartão de crédito a Pluggy devolve a compra **positiva**; o app antigo contava compras como "entradas". Agora o sinal vem do campo `type` (DEBIT = saída, CREDIT = entrada).
2. **Pagamento de fatura do lado do cartão** (`operationType = PAGAMENTO_FATURA`) agora é excluído, como já era o débito na conta — antes a fatura entrava duas vezes.

## Próximas fases

- **Pluggy Connect + webhooks** (depois do contrato com a Pluggy): cada pessoa conecta o banco pelo widget, com `clientUserId` = usuário.
- **Servidor MCP** (Agents SDK + OAuth) reaproveitando os `service.ts`.
- Exportação para Google Sheets (no Flask existia; aqui só CSV por enquanto).
- Regras de categoria por cartão adicional (final do cartão → pessoa) para atribuir "quem gastou" automaticamente — a Pluggy já informa os cartões adicionais.
- Acerto de contas entre familiares, alertas (fatura acima da média, vencimento, meta atrasada) e resumo semanal por e-mail.
