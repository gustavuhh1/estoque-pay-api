# Backlog de Melhorias Futuras (Fora do Escopo Atual)

> Documento vivo: registro contínuo de melhorias técnicas identificadas ao longo do desenvolvimento, mas que **não entram no planejamento atual** por escolha deliberada — o foco agora é terminar as fases já mapeadas em `Requisitos_e_Regras_de_Negocio_V5_EstoquePay.md`.
>
> Isto não é um backlog de bugs nem de requisitos funcionais (esses viram issues no GitHub, ligados a uma fase). É um repositório de **dívida técnica e hardening consciente**: coisas que sabemos que precisam ser feitas antes de produção/escala, mas que decidimos adiar de propósito para não desviar do plano em andamento.

## Como usar este documento

- Adicione um item sempre que identificar uma melhoria que **vale a pena registrar, mas não vale a pena fazer agora**.
- Cada item deve ter: o que é, por que importa (o risco de não fazer), onde no código isso se manifesta (arquivo:linha, quando aplicável), e uma sugestão de quando revisitar.
- Quando um item for planejado de verdade, ele sai daqui e vira uma issue no GitHub (referenciar o número da issue na linha do item antes de remover, para rastreabilidade).
- Não é necessário estimar prioridade/esforço com precisão — o objetivo é não esquecer, não é gerenciar um sprint.

---

## Itens registrados

### 1. Logging desligado

**O quê**: `fastify({ logger: false })` em [src/app.ts:18](../src/app.ts#L18) — o servidor roda sem nenhum log estruturado.

**Por que importa**: sem logging, depurar um incidente em produção vai ser às cegas — nenhum rastro de requisições, erros ou tempos de resposta. Isso deveria mudar antes de qualquer deploy real.

**Quando revisitar**: antes do primeiro deploy em ambiente que não seja dev local. Vale avaliar `pino` (nativo do Fastify) com transporte estruturado (JSON) e correlação por `requestId` (que já existe no envelope de erro — só falta também aparecer nos logs de sucesso).

---

### 2. CORS permissivo

**O quê**: `cors({ origin: true })` em [src/app.ts:33](../src/app.ts#L33) reflete qualquer `Origin` enviado pelo cliente.

**Por que importa**: funciona hoje porque não há `credentials: true` explícito, mas quando o front (Next.js) precisar mandar o cookie de sessão cross-origin, isso vai precisar virar um allowlist de domínios. Do jeito que está, é um convite a apertar essa configuração depois, com pressa e sob risco de quebrar o front em produção.

**Quando revisitar**: quando o repositório do front-end estiver definido e os domínios de deploy (dev/staging/produção) forem conhecidos — trocar por uma lista explícita de origins permitidas.

---

### 3. Sem `@fastify/helmet`

**O quê**: nenhum header de segurança (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc.) — o plugin não está instalado nem registrado.

**Por que importa**: são headers de baixo custo e alto retorno contra uma classe inteira de ataques (clickjacking, MIME sniffing, etc.). Não é urgente em dev, mas é literalmente `npm install` + `app.register()` antes de expor a API publicamente.

**Quando revisitar**: junto do hardening pré-produção, mesma leva do CORS.

---

### 4. Sem rate limiting

**O quê**: nenhuma rota tem throttle, `/auth/login` incluída.

**Por que importa**: login sem rate limit é superfície aberta para força bruta de senha. `/auth/forgot-password` também é candidato (evita abuso do envio de e-mail via Brevo).

**Quando revisitar**: antes de expor a API fora da rede local — avaliar `@fastify/rate-limit`, com limite mais agressivo especificamente nas rotas de auth.

---

### 5. Sem versionamento de rota

**O quê**: todas as rotas são `/auth`, `/estabelecimento`, etc., sem prefixo de versão (`/v1`).

**Por que importa**: a API só vai crescer — ainda tem 4 fases inteiras no roadmap (`Requisitos_e_Regras_de_Negocio_V5_EstoquePay.md`). Decidir a estratégia de versionamento agora, enquanto há poucas rotas, é muito mais barato do que migrar depois com clientes (o front, e futuramente integrações externas) já dependendo do formato atual.

**Quando revisitar**: antes de a API ter um primeiro consumidor externo estável (o front-end em produção conta). Decisão a tomar: prefixo de path (`/v1/...`) vs. header de versão — path é mais simples de documentar no Swagger e mais comum em APIs REST públicas.

---

### 6. Inconsistência de shape de resposta

**O quê**: `GET /estabelecimento` devolve um array puro (`[{...}, {...}]`), enquanto `POST /estabelecimento` devolve um objeto envelopado (`{ message, estabelecimento, membro }`).

**Por que importa**: nenhuma das duas convenções está errada isoladamente (lista pura é uma convenção REST válida), mas não existe uma regra escrita em lugar nenhum sobre quando envelopar e quando não — o que abre espaço para inconsistência crescer conforme mais rotas forem criadas nas próximas fases (produtos, categorias, clientes, vendas...).

**Quando revisitar**: vale decidir a convenção (por exemplo: "toda listagem é array puro; toda escrita com efeito colateral relevante — criar vínculo, gerar evento — vem envelopada com contexto extra") e documentar isso como uma norma do projeto (talvez em um `CONTRIBUTING.md` ou seção própria nos docs de requisitos), antes que a Fase 2 (produtos/categorias) multiplique o padrão que já existir.
