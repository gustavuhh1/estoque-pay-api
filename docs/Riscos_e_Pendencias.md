# Riscos e Pendências

> Riscos de negócio já conhecidos e ainda sem solução, mais a dívida técnica que ficou fora do escopo (D4). Substitui o `Melhorias_Futuras_Backlog.md`. Quando um item for planejado, vira issue no GitHub e sai daqui.
>
> Última revisão: 04/11/2026.

## Riscos de negócio

### 1. Pix pago sem estoque

Se o estoque acabar entre a geração do QR Code e o pagamento, a consolidação volta atrás (`409 ESTOQUE_INSUFICIENTE`) e a venda fica `PENDENTE` com o dinheiro já recebido.

**Para resolver** é preciso uma decisão de negócio: reservar o estoque ao gerar o QR Code, ou permitir saldo negativo nesse caso.

### 2. Nota que sobrevive ao cancelamento

Cancelar uma venda não cancela a NFC-e simulada já emitida: não existe evento de cancelamento simulado. A nota também continua acessível depois que a loja perde o Premium.

### 3. Recontratação impossível

Uma loja que cancelou a assinatura não consegue assinar de novo: o trial é um só, e uma assinatura cancelada conta como registrada (`409 ASSINATURA_JA_EXISTENTE`). Recontratar sem trial seria outro fluxo, que não existe.

### 4. Limite de 50 produtos furável

A checagem do limite do Free é contagem seguida de insert, sem trava. Duas criações simultâneas no 50º produto podem passar do teto por um item. Aceitável para um limite comercial.

### 5. Pagamento real da assinatura não testado

O checkout da AbacatePay abre, mas o pagamento com cartão de teste nunca foi concluído. As lojas Premium de teste usam estados gravados pelo seed (`scripts/seed.ts`). Também segue em aberto **qual chave assina o HMAC do webhook**: o gateway aceita `ABACATEPAY_WEBHOOK_SECRET` e `ABACATEPAY_WEBHOOK_HMAC_KEY` até a primeira entrega real confirmar.

## Dívida técnica (fora do escopo, D4)

| Item | Situação hoje | Onde |
| --- | --- | --- |
| Logging | Desligado (`logger: false`); erros têm `requestId`, mas não há log estruturado. | `src/app.ts` |
| Headers de segurança | `@fastify/helmet` não instalado. | `src/app.ts` |
| Rate limiting | Só o do better-auth nas rotas de autenticação (3 requisições a cada 10 s). As rotas de negócio não têm limite. | `src/lib/auth.ts` |
| Versionamento de rota | Sem prefixo `/v1`. | `src/routes.ts` |
| Formato de resposta | Sem convenção escrita: algumas listagens devolvem array puro, outras `{ data, total, page, limit }`; algumas escritas vêm envelopadas. | Vários módulos |
| Dados de teste em produção | Contas `teste-etapa7-*` e `teste-front-*` e lojas de teste ficaram no banco; não há rota para apagar lojas. | Banco Neon |

O CORS, que estava nesta lista, já foi resolvido: em produção a API aceita só as origens de `TRUSTED_ORIGINS`/`APP_URL` (`src/lib/origens.ts`).
