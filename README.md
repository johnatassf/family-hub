# Família — plataforma familiar com módulos (Cloudflare)

Plataforma web para famílias organizarem a vida em conjunto, em duas áreas: **Finanças da família** e **Empresa** (o controle do negócio de cada um). Nas finanças, cada pessoa conecta os próprios bancos e cartões pela [Pluggy](https://pluggy.ai), as contas nascem **privadas** e o dono decide compartilhar com a família — útil para acompanhar cartões usados por várias pessoas e indicar **quem gastou** cada compra.

Substitui o protótipo Flask em `../financeiro-pluggy` (mantido como referência).

## Stack

| Camada | Tecnologia |
|---|---|
| Hospedagem | Cloudflare Workers (um Worker serve a API e o React) |
| Banco | Cloudflare D1 (SQLite gerenciado), SQL parametrizado puro |
| API | Hono + zod |
| Login | Better Auth: Google, código por e-mail, senha + 2FA (TOTP) |
| Frontend | React 19 + Vite + React Router + TanStack Query + Tailwind + Recharts |
| E-mail | Brevo (`BREVO_API_KEY`, 300/dia grátis, sem domínio próprio), Resend (`RESEND_API_KEY`) ou Cloudflare Email Service (`env.EMAIL`) |
| Testes | Vitest rodando dentro do runtime do Workers (`@cloudflare/vitest-plugin`) |

**Custo previsto:** Workers Paid **US$ 5/mês** (inclui D1, KV, Cron, rate limiting e 3.000 e-mails/mês) + domínio. O plano gratuito serve para desenvolver, mas limita cada requisição a 10 ms de CPU (não aguenta hash de senha nem sincronizar ~1.400 transações) e não envia e-mail. **Pluggy:** Meu Pluggy é grátis só para uso pessoal; uso por várias pessoas exige conversar com o comercial deles.

## Estrutura

```
apps/platform/            o único Worker: API (src/worker) + React (src/web)
  migrations/             SQL do D1 (0001 auth gerado pelo Better Auth, 0002 núcleo, 0003 financeiro)
  test/                   testes (login, regras de acesso, sincronização, paridade com o Python)
  wrangler.jsonc          bindings: dev local, staging e produção
packages/core/            login, famílias, convites, papéis, auditoria, rate limit, headers
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

- Em dev, os e-mails **não são enviados**: o código aparece no terminal (`[dev-email] ... Seu código é 123456`).
- O primeiro acesso só funciona para e-mails em `BOOTSTRAP_OWNER_EMAILS`; essa pessoa vira dona da família e convida as outras pela tela **Família**.
- Dono(a) e administradores precisam ativar 2FA antes de usar o app.

```bash
npm test            # 124 testes no runtime do Workers
npm run typecheck   # Worker, React e configs
npm run build
```

## Deploy na Cloudflare (primeira vez)

```bash
cd apps/platform
npx wrangler login

# 1. Recursos (anote os IDs e cole em wrangler.jsonc, env.staging e env.production)
npx wrangler d1 create familia-hub-staging
npx wrangler d1 create familia-hub
npx wrangler kv namespace create KV --env staging
npx wrangler kv namespace create KV --env production

# 2. Segredos (repita com --env production)
npx wrangler secret put BETTER_AUTH_SECRET --env staging     # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put BOOTSTRAP_OWNER_EMAILS --env staging
npx wrangler secret put PLUGGY_CLIENT_ID --env staging
npx wrangler secret put PLUGGY_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_CLIENT_ID --env staging        # opcional
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging    # opcional
npx wrangler secret put TURNSTILE_SITE_KEY --env staging      # recomendado
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging    # recomendado

# 3. Banco e publicação
npm run db:migrate:staging
npm run deploy:staging
```

Depois, no painel da Cloudflare:
- **Domínio:** em `wrangler.jsonc` troque `SEU-DOMINIO.com.br` e adicione a rota/domínio customizado do Worker.
- **E-mail:** sem domínio, use o Brevo: `npx wrangler secret put BREVO_API_KEY --env production` (chave "API key", não a SMTP) e `EMAIL_FROM` com o remetente verificado no Brevo. Com domínio, dá para usar o *Email Service* da Cloudflare (Workers Paid; registros SPF/DKIM) ou o Resend; o binding `send_email` tem prioridade.
- **Staging protegido:** crie uma aplicação no *Zero Trust → Access* para `staging.SEU-DOMINIO.com.br` (grátis até 50 usuários).
- **Google OAuth:** URI de redirecionamento `https://SEU-DOMINIO.com.br/api/auth/callback/google`.
- **Turnstile:** crie um widget para o domínio e use as chaves acima.

Com o GitHub: cadastre `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` nos *secrets* do repositório. A CI roda testes em todo PR, publica em staging a cada push na `main` e em produção pelo botão *Run workflow*.

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
- **2FA obrigatório** para dono(a)/admin. Quem tem 2FA não entra só com código de e-mail (seria um rebaixamento de segurança).
- **Privacidade entre familiares:** toda consulta passa por uma única regra (`packages/finance/src/server/access.ts`); nem o dono da família vê conta privada de outra pessoa. Só o dono da conta edita os lançamentos dela.
- **Proteção de itemId:** conferido na Pluggy antes de salvar; um item só tem um dono na plataforma.
- **Rate limit em duas camadas** (binding do Workers por IP/usuário + Better Auth por endpoint), **Turnstile** nos formulários, trava de 5 min por sincronização.
- **CSRF** (checagem de `Origin`), cookies `HttpOnly`/`Secure`/`SameSite=Lax`, **CSP** restrita e demais headers (`public/_headers` e API), validação zod em toda rota, CSV protegido contra injeção de fórmula.
- **Auditoria** de logins, convites, papéis, compartilhamentos, sincronizações e exportações.
- **LGPD:** excluir a conta apaga os dados e revoga as conexões na Pluggy; sair da família leva os dados da pessoa junto.
- Segredos só no servidor (`wrangler secret` / `.dev.vars`), nunca no bundle do navegador.

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
