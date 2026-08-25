# Auditoria dos motores de consumo, compra, estoque e produção — 25/08/2026

## Conclusão executiva

O cálculo exibido em **Consumo de Materiais** e nas fichas de operador passou a
usar a mesma fronteira SQL que sustenta reserva, baixa, custeio, MRP e compra.
O frontend não mantém mais um segundo motor autoritativo: ele adapta o retorno
canônico, calcula a disponibilidade corrente e apresenta os avisos da mesma
identidade de material, conversão e grade resolvidas no banco.

| Uso | Fonte após os ajustes | Situação |
|---|---|---|
| Tela/PDF de Consumo de Materiais | `calculate_consumption_report_batch` → motor SQL por grade | Canônico |
| Fichas de operador | Mesmo relatório canônico em lote | Canônico |
| Reserva, baixa e snapshot da OP | `calculate_order_consumption_by_grade` | Canônico |
| Custeio e MRP | Motor SQL operacional e snapshots versionados | Canônico |
| Compra exclusiva por PV | Cálculo por PV + comandos transacionais idempotentes | Canônico |
| Embalagem | Motor único de slots/caixas | Canônico |
| Tiras | Necessidade canônica por família/medida e lote | Canônico |
| Lista de Separação | Consumo bruto + camada própria de separação líquida | Especialização deliberada |

A **Lista de Separação** continua tendo uma camada especializada de saldo já
separado/reservado. Ela não é fonte para reserva, baixa, custeio, MRP ou OC. A
geometria autoritativa permanece no SQL; essa exceção deve continuar coberta por
paridade para não voltar a ser um motor concorrente.

## Evidências reproduzidas

### PV-00162

- 12 itens e 780 pares, em produção.
- O solado calculado é `SOLADO 01 CARAMELO`, com 780 pares.
- Grade necessária: 34=65, 35=68, 36=192, 37=133, 38=192, 39=65 e 40=65.
- Estoque útil por grade: zero; falta total: 780 pares.
- A tela anterior deixava o bloco de solado abaixo da primeira dobra e fechado.
  O novo layout o mantém aberto, no topo, com necessidade, saldo e compra por
  numeração.
- A ficha NL03 repetia o mesmo componente direto três vezes. A consolidação por
  identidade impede a multiplicação artificial desse consumo.

### Divergências TS × SQL eliminadas

A paridade real encontrou duas causas de diferença:

- grupos heterogêneos podiam levar TS e SQL a escolherem produtos físicos
  diferentes para uma mesma palmilha;
- a embalagem discreta era arredondada por item no cliente e somada como fração
  no servidor.

A migration `20270101011600_consumption_parity_hotfix.sql` corrige a escolha de
identidade e a migration `20270101012300_canonical_consumption_report_batch.sql`
remove o segundo cálculo do relatório. A embalagem passou a usar o contrato
canônico criado em `20270101012400_per_pv_canonical_packaging_purchase.sql`.

### Snapshot operacional × simulação atual

O relatório mostra a ficha e a disponibilidade **atuais**. Uma OP já criada pode
ter um snapshot histórico diferente, porque ele representa a verdade operacional
congelada no momento da materialização. A interface identifica essa diferença e
não promete reescrever silenciosamente uma OP existente.

Nenhum saldo ou snapshot histórico foi recalculado em massa. Gaps antigos ficam
visíveis nos diagnósticos e exigem reconciliação explícita.

### Lacunas cadastrais de solado

Há itens legados cujo texto informa um solado, mas sem vínculo por
`sole_group_id`, `primary_sole_id` ou mapeamento de referência. O motor agora
falha fechado e o diagnóstico lista a pendência; a auditoria não inventou um SKU
para esses pedidos.

Também permanecem lacunas de especificação por numeração em solados que dirigem
forro/palmilha. `list_sole_spec_gaps()` e o relatório de consistência mostram a
faixa vendida sem cadastro. Preencher dm² por numeração é dado de engenharia do
produto, não uma aproximação que possa ser criada por migration.

## Ordem de compra exclusiva por pedido

O recorte de exclusividade foi confirmado: os atalhos enviam somente o ID do PV
selecionado e o servidor filtra esse conjunto antes de calcular necessidade.

Os riscos encontrados no fluxo antigo foram fechados em duas camadas:

1. O comando atômico por PV valida preço, fornecedor, unidade, grade, tiras e
   embalagem antes de gravar qualquer OC; usa `requestId` durável e impede retry
   duplicado.
2. A fronteira genérica de OC serializa criação, alteração, cancelamento,
   recebimento e reflexos financeiros/estoque, com receipt idempotente e ACL
   fechada.

O fluxo persiste a grade de solado, desconta estoque por numeração, considera
OCs/ROPs já abertas e grava o snapshot comercial necessário para que uma futura
alteração de cadastro não mude retroativamente a compra já emitida.

## Consumo, embalagem e tiras

- `calculate_consumption_report_batch` recebe uma lista deduplicada de PVs e
  chama o cálculo SQL canônico por grade.
- O adapter TypeScript valida o schema, preserva identidade de produto/variante,
  transforma o retorno para tela/impressão e calcula disponibilidade atual.
- Consumos de área usam largura da ficha de componente; solado é sempre por
  numeração; item linear direto não é convertido.
- Nenhum caminho reintroduz perda de corte.
- Embalagens são calculadas por slots/caixas discretas e não por frações
  acumuladas divergentes.
- Tiras usam a mesma necessidade por família e medida na visualização, produção,
  estoque e compra, com diagnóstico de configuração incompleta.

## Estoque e produção

Foram encontrados overloads legados, estornos sem prova no ledger e mutações
diretas espalhadas no cliente. A sequência de migrations:

- neutraliza e revoga o débito legado divergente;
- calcula estorno apenas pelo líquido comprovado `SUM(out) - SUM(in)`;
- serializa OP, produto, grade e tipo de caixa;
- usa a `effective_grade` realmente consumida, sem fabricar distribuição;
- transforma reserva pendente na finalização em baixa real ou pendência de
  reconciliação visível;
- expõe furos atuais sem alterar o histórico;
- concentra ajustes manuais, cadastro, configuração de grade e estoque pronto
  em comandos idempotentes com comparação de versão/saldo e ledger.

Quando não há estoque suficiente, a finalização da OP continua tolerante: baixa
o disponível e registra a diferença como pendência. Ela não volta a usar a
função estrita que impediria o chão de fábrica de finalizar uma OP.

## NF-e e integridade financeira

A auditoria ampliada também fechou caminhos que podiam deixar estoque, status
fiscal e financeiro em estados incompatíveis:

- devolução usa comando durável, request idempotente, grade efetiva e aborta a
  reserva quando o provedor não foi chamado;
- cancelamento só avança de forma monotônica após evidência do provedor;
- retries ambíguos não promovem um cancelamento local por inferência;
- consultas e sincronizadores de status passam pela mesma função de observação,
  em vez de atualizar `nfe_emitidas` diretamente;
- saúde de faturamento e diagnósticos compõem NF-e, contas a receber, reservas,
  baixa e fluxo canônico de tiras.

A migration experimental de emissão `20270101012700` não integra ainda a Edge
Function emissora e, por isso, **não faz parte da promoção**. Seu conteúdo é
preservado como rascunho técnico, fora de `supabase/migrations`, para impedir que
o workflow registre uma versão incompleta e nunca a reaplique.

### Retificação após a primeira promoção

A verificação operacional do primeiro deploy encontrou dois defeitos que os
replays com a chave legada não reproduziam:

- a chave moderna `sb_secret_*` assume o papel PostgreSQL `service_role`, mas não
  preenche o GUC legado `request.jwt.claim.role`; por isso os workers e crons
  fiscais eram recusados mesmo estando autenticados corretamente;
- o trigger diferido da origem de compra de tiras validava a imagem `NEW` já
  apagada durante a reconciliação, em vez do item que realmente sobreviveu no
  estado final da transação.

`20270101012800_service_role_secret_key_rpc_acl.sql` substitui essa suposição por
uma fronteira única que reconhece o papel efetivo e mantém ACLs fechadas. A
migration cobre os RPCs chamados diretamente e suas dependências transitivas,
inclusive os triggers de estoque e comando de PV. Seu contrato testa os dois
formatos de autenticação sem abrir execução para `PUBLIC` ou `anon`.

`20270101012900_fix_deferred_strap_purchase_origin_final_state.sql` passa a
validar somente o item atual que ainda existe ao fim da transação. Um tombstone
apagado deixa de causar falso erro, enquanto uma origem de tira inválida que
realmente sobrevive continua bloqueada.

A auditoria também encontrou a Edge Function remota órfã `gc-probe-temp`, sem
fonte no repositório e com autenticação desligada. Ela foi incorporada como
tombstone versionado: não lê segredo, não chama provedor, responde `410` quando
autenticada e agora exige JWT no gateway. Assim a superfície deixa de ser um
proxy fiscal oculto sem depender de uma exclusão irreversível no painel.

## Correções da tela e do relatório

- mapa de solados sempre aberto e no topo da área principal;
- mapa de solados calculado antes dos filtros de material, para continuar
  visível ao pesquisar ou selecionar somente napa, palmilha ou outro grupo;
- necessidade, estoque útil e compra por número na mesma matriz;
- cadastro incompleto nunca aparece como “coberto”;
- ação **Gerar OC** permanece visível no trilho lateral;
- foco em um único pedido preservado na URL e no RPC;
- embalagem sem fornecedor bloqueia a OC antes do envio; produto comum sem
  fornecedor continua no agrupamento manual permitido pelo contrato;
- IDs repetidos são deduplicados;
- falha de contexto interrompe o relatório, em vez de apresentar um parcial
  como se fosse completo;
- produtos distintos não compartilham falsamente saldo por grupo/cor;
- hierarquia visual, largura, densidade, estados vazios e avisos foram ajustados
  para leitura operacional em desktop e impressão.

## Sequência promovível

As migrations formam uma única sequência linear promovível `20270101010100` →
`20270101012900`, com **127 deliberadamente ausente** porque permanece apenas no
rascunho técnico. A ordem é obrigatória: versões registradas no Supabase não são
reaplicadas pelo workflow. Em especial, 109 precede 117; 117→120 compõem os
diagnósticos; 121 fecha OC genérica; 122 devolução; 123 relatório canônico; 124
embalagem por PV; 125 estoque; 126 status fiscal monotônico; 128 corrige a
fronteira `service_role`; 129 valida a origem de tiras pelo estado final.

## Validação final

A candidata retificada foi validada em 25/08/2026 com:

- **3.353 testes aprovados** em 343 arquivos; 8 testes de integração em 5
  arquivos ficaram `skip` somente porque exigem o ambiente DB/CI explícito;
- contratos focados adicionais verdes: 348/348 no recorte amplo, 91/91 após a
  limpeza de tipos, 78/78 na UI/OC, 86/86 em estoque e 42/42 após o freeze SQL;
- typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit`,
  `lint:baseline`, build de produção, tokens, ARIA, branding, navegação e
  `git diff --check` verdes;
- parse `pglast` dos 26 arquivos SQL e replay lossless das migrations 101→126
  no Supabase de produção, em uma transação: **1.066 statements**, 18 gates e
  `ROLLBACK` confirmado; as migrations 128 e 129 também tiveram parse integral,
  validação dos corpos PL/pgSQL e replay transacional isolado com `ROLLBACK`;
- PV-00146 com três escopos e zero divergência de `effective_grade`; PV-00162
  com paridade de material, embalagem e tiras, inclusive delta zero entre o
  motor operacional e o relatório no recorte de OP;
- preflight ESM das 18 Edge Functions e contratos de ordenação de deploy 2/2;
- revisão da cadeia `main → CI → banco → Edge/Vercel`, sem bloqueador P0/P1.

Os 8 skips não foram tratados como evidência de banco. O replay transacional,
os self-tests SQL e os casos vivos foram executados separadamente contra o
projeto real para cobrir essa lacuna sem persistir dados durante a auditoria.

## Estado de entrega

O pacote possui GO técnico para uma promoção única. A própria cadeia impede
publicação parcial: migrations, Edge Functions e Vercel usam o SHA aprovado pelo
CI; frontend e Edge aguardam todas as versões SQL pós-cutover; jobs obsoletos são
recusados. A confirmação operacional final pertence aos runs e ao deployment do
commit promovido, pois esse estado externo pode mudar depois da emissão deste
documento.
