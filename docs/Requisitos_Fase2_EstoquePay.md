# Documento de Requisitos - Fase 2 (Gestão de Estoque)

## 1. Requisitos Funcionais (RF)
*O que o sistema deve fazer de ponta a ponta.*
* **RF01 - Gestão Completa de Produtos (CRUD):** O sistema deve permitir criar, listar, editar e excluir permanentemente produtos do estabelecimento.
* **RF02 - Ativação/Inativação (Visibilidade):** O sistema deve permitir que o gestor alterne o status do produto entre "Ativo" e "Inativo".
* **RF03 - Gestão Completa de Categorias (CRUD):** O sistema deve permitir criar, listar, editar e excluir categorias, além de permitir vincular múltiplas categorias a um único produto (N:N).
* **RF04 - Lançamento Manual de Movimentação:** O sistema deve permitir a alteração (entrada ou saída) da quantidade em estoque de um produto através de uma interface de lançamento, exigindo a seleção de um motivo (Ex: Reabastecimento, Descarte, Perda, Vencimento).
* **RF05 - Relatório de Auditoria/Movimentação:** O sistema deve listar o histórico detalhado de todas as movimentações de estoque de um produto, indicando o usuário responsável, data, quantidade alterada e o motivo pré-definido.
* **RF06 - Exposição de Alertas de Estoque Mínimo:** O sistema deve identificar e disponibilizar rotas para que o front-end exiba (na aba de Estoque e no Dashboard principal) os produtos cuja quantidade_atual seja igual ou inferior à quantidade_minima configurada.

## 2. Regras de Negócio (RN)
*As restrições e regras que ditam como as funcionalidades operam.*
* **RN01 - Regra de Inativação vs. Exclusão:** Um produto "Inativo" continuará no banco de dados com todo o seu histórico, mas será sinalizado para o front-end (PDV) como indisponível/cinza para vendas. A "Exclusão" de um produto, por outro lado, será permanente e apagará também os registros atrelados (como movimentações).
* **RN02 - Exclusão Desimpedida de Categorias:** O sistema não impedirá a exclusão de uma categoria que possua produtos vinculados. Ao excluir a categoria, o back-end deve apenas remover as "etiquetas" dos produtos, mantendo os produtos intactos no estoque.
* **RN03 - Obrigatoriedade Fiscal (NFC-e):** Todo cadastro ou edição de produto deve exigir o preenchimento dos códigos fiscais obrigatórios: NCM (Nomenclatura Comum do Mercosul) e CFOP (Código Fiscal de Operações e Prestações).
* **RN04 - Suporte a Frações:** O sistema deve permitir operações matemáticas de adição, subtração e definição de estoque utilizando casas decimais (ex: 0.300 kg) para produtos não unitários.
* **RN05 - Rastreabilidade Automática:** Nenhuma alteração na quantidade de estoque do produto pode ser feita sem que um registro imutável seja criado na tabela de auditoria (MovimentacaoEstoque).

## 3. Requisitos Não Funcionais (RNF)
*Como o sistema deve se comportar tecnicamente.*
* **RNF01 - Atualização do Schema:** O modelo de dados do Prisma deverá ser atualizado para contemplar o campo booleano ativo na tabela Produto e a criação da tabela MovimentacaoEstoque.
* **RNF02 - Qualidade (TDD):** Todos os cálculos de entrada/saída de frações, limites e exclusões em cascata deverão possuir cobertura de testes unitários utilizando Vitest.
