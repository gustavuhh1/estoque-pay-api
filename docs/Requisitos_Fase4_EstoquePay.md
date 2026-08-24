# Documento de Requisitos - Fase 4 (CRM e Emissão NFCe)

## 1. Requisitos Funcionais (RF)

_O que o sistema deve fazer de ponta a ponta._

- **RF01 - Gestão de Clientes (CRUD):** O sistema deve permitir o cadastro, listagem, atualização e visualização de clientes, armazenando CPF, Nome, Telefone, Observação e Data de Nascimento.
- **RF02 - Vincular Cliente à Venda:** O sistema deve permitir a vinculação de um cliente previamente cadastrado a uma venda no PDV, possibilitando a emissão de cupons fiscais identificados.
- **RF03 - Histórico e Fidelidade:** O sistema deve realizar a indexação dos clientes às compras realizadas. Com base nisso, o sistema deve fornecer inteligência de dados (como o cálculo de produtos favoritos) e suportar a emissão/resgate de cupons para o programa de fidelidade.
- **RF04 - Preparação Fiscal:** Após a confirmação de um pagamento no PDV, o sistema deve compilar automaticamente os dados da venda, do estabelecimento e do cliente (se houver) no formato exigido pela SEFAZ.
- **RF05 - Disparar Emissão (Integração):** O sistema deve enviar assincronamente (em segundo plano) uma requisição JSON para a API parceira (ex: Focus NFe) com os dados compilados para emissão da NFCe.
- **RF06 - Retorno e Armazenamento Fiscal:** O sistema deve possuir uma rota (webhook) ou rotina para receber o retorno da API terceira, salvando na tabela de vendas apenas o status da emissão e as URLs dos arquivos PDF e XML.

## 2. Regras de Negócio (RN)

_As restrições e regras que ditam como as funcionalidades operam e se protegem._

- **RN01 - Prorrogação de Cadastro (NFCe):** Para que a emissão de nota fiscal funcione, o sistema exigirá que o estabelecimento tenha cadastrado seu CNPJ, Inscrição Estadual (IE) e feito o upload do Certificado A1. Além disso, os produtos vendidos devem obrigatoriamente possuir NCM e CFOP válidos.
- **RN02 - Processamento Assíncrono:** A comunicação com a API de NFCe não pode travar ou atrasar a tela do caixa. O disparo deve ser assíncrono (emissão "invisível" em segundo plano).
- **RN03 - CPF Opcional:** A vinculação de um cliente (CRM) no momento da venda é opcional. Se não for informado, a NFCe será emitida como "Consumidor Não Identificado".
- **RN04 - Terceirização Fiscal:** O sistema é estritamente proibido de gerar XMLs manualmente ou tentar comunicação direta (mensageria) com a SEFAZ, delegando toda a operação complexa à API parceira.

## 3. Requisitos Não Funcionais (RNF)

_Como o sistema deve se comportar tecnicamente._

- **RNF01 - Tolerância a Falhas:** Caso a API terceira esteja fora do ar no momento da venda, o sistema deve marcar a `nfe_status` como ERRO e permitir uma retentativa posterior no painel, não impedindo que o caixa continue operando e vendendo normalmente.
