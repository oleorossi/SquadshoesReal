# Auditoria dos motores de consumo, compra e baixa — 25/08/2026

## Conclusão executiva

O sistema **não usa hoje um único motor de cálculo de ponta a ponta**.

| Uso | Motor atual | Resultado da auditoria |
|---|---|---|
| Tela/PDF de Consumo de Materiais | TypeScript (`orderConsumption`) | Recalcula a ficha vigente e o estoque atual |
| Fichas de operador | TypeScript (`orderConsumption`) | Compartilha o motor da tela |
| Lista de Separação/BOM | TypeScript (`bomConsumption`) | Reimplementação independente, agora com guards adicionais |
| Reserva, baixa, custeio e MRP | SQL (`calculate_order_consumption_by_grade`) + snapshot da OP | Caminho separado do relatório |
| Compra exclusiva por PV | SQL (`compute_materials_per_pv`) | Escopo por PV correto, mas a gravação antiga não era atômica |

Logo, o relatório ainda não é apenas uma visualização do mesmo fato consumido
pelo estoque. A estratégia segura é manter o SQL como fronteira operacional,
congelar seu resultado por versão e fazer tela, PDF, reserva, baixa, custeio, MRP
e compra lerem esse mesmo cálculo/snapshot. Enquanto essa consolidação não for
concluída, a paridade TS×SQL precisa continuar sendo bloqueada por testes reais.

## Evidências reproduzidas

### PV-00162

- 12 itens, 780 pares, status `Em Produção`.
- O solado **não estava ausente no cálculo**: `SOLADO 01 CARAMELO`, 780 pares.
- Grade necessária: 34=65, 35=68, 36=192, 37=133, 38=192, 39=65, 40=65.
- Estoque útil por grade: zero; falta total: 780 pares.
- Na tela anterior, o bloco começava abaixo da primeira dobra e ainda precisava
  ser expandido. Isso explicava a percepção de que o solado não aparecia.
- A ficha NL03 repetia literalmente o mesmo `ELÁSTICO 6MM` três vezes em
  `direct_components`. O SQL deduplicava o `product_id` original; o TS somava
  três vezes: 2.160 cm em vez de 720 cm para 36 pares.

### Divergência TS × SQL

A suíte real de paridade falhou com seis diferenças nas referências S-039/DS21:

- palmilha: o SQL podia escolher um SKU linear num grupo heterogêneo, enquanto
  o TS escolhia o SKU físico de área;
- embalagem: o TS arredondava caixa discreta por item (`CEIL`), enquanto o SQL
  somava frações como 0,498/0,581 caixa.

A migration autônoma `20270101011600_consumption_parity_hotfix.sql` corrige
essas duas causas para novos cálculos, sem alterar snapshots históricos.

### Snapshot operacional × simulação atual

- A tela/PDF usam ficha e estoque **atuais**.
- Reserva/baixa da OP podem usar o snapshot congelado na criação/materialização.
- Entre 43 OPs ativas com snapshot, 37 apresentaram diferença maior que 0,01
  contra o consumo SQL atual (116 linhas divergentes).
- No PV-00162, 6 de 12 snapshots estavam desatualizados. O solado permanecia
  780 em ambos, mas a palmilha atual não reproduzia o histórico congelado.

Por isso a interface agora nomeia o resultado como **“Simulação atual · ficha e
estoque agora”**; “Atualizar simulação” não promete reescrever uma OP existente.

### Lacunas cadastrais de solado

- Três itens em produção (PV-00139 e PV-00142) têm “Solado Ricardo Tratorado”
  apenas como texto, sem `sole_group_id`, `primary_sole_id` ou mapeamento.
- Dois itens em rascunho do PV-00138 têm o mesmo problema com “Solado Barato”.
- Nesses casos o SQL omite o solado de reserva, baixa e custeio. A auditoria não
  inventou o produto correto: o vínculo precisa ser decidido no cadastro.

## Ordem de compra exclusiva por pedido

O recorte de exclusividade estava correto: os dois atalhos passam exatamente o
ID do PV escolhido, e o SQL filtra por `sale_order_id = ANY(p_pv_ids)`.

O processo de gravação, porém, não era seguro:

- criava uma OC por fornecedor em chamadas sequenciais;
- um preço zero podia falhar no último fornecedor após as OCs anteriores já
  terem sido criadas;
- o retry só tinha uma janela curta e podia duplicar o lote;
- a grade do solado era exibida, mas não era gravada em `purchase_order_items`;
- a falta do solado era abatida pelo saldo total, não por numeração;
- OCs/ROPs abertas para o mesmo produto não bloqueavam nova compra;
- o botão podia aparecer para um papel que o backend recusaria.

A migration `20270101011000_atomic_per_pv_purchase_orders.sql` e o novo hook:

- pré-validam preço, fornecedor, unidade, grade e itens de tira;
- gravam todos os fornecedores/itens numa única transação;
- usam `requestId` durável para retry idempotente;
- persistem a grade e descontam `stock_grade` número a número;
- bloqueiam compra já aberta, com override explícito;
- alinham a permissão a admin/gerente.

## Estoque e produção

Foram encontrados dois caminhos vivos perigosos:

- o overload legado de cinco argumentos de `hybrid_debit_stock_for_order` era
  executável por `PUBLIC/anon` e mantinha uma implementação divergente;
- os estornos de produto e solado haviam regredido: o primeiro podia creditar
  novamente todas as saídas; o segundo usava a grade original da OP, sem
  movimento de entrada e sem marcador idempotente.

A migration `20270101011200_restore_stock_net_ledger_and_debit_guards.sql`:

- neutraliza e revoga o overload legado;
- calcula estorno escalar por `SUM(out) - SUM(in)`;
- serializa por OP e trata `products`, `stock_grade` e `box_types`;
- estorna solado somente pela `effective_grade` consumida e comprovada pelo
  ledger; consumo sem saída física não cria estoque fantasma;
- quando existe débito parcial sem distribuição confiável por número, falha
  alto e exige reconciliação, em vez de inventar a grade;
- registra `stock_movements` de entrada e `sole_restored_at`.

Nenhum saldo ou snapshot histórico foi reconciliado por esta auditoria.

## Correções da tela e do relatório

- mapa de solados sempre aberto e colocado no topo da coluna principal;
- necessidade, estoque útil e compra por numeração visíveis na mesma matriz;
- cadastro incompleto deixa de aparecer como “grade coberta”;
- ação “Gerar OC” permanece visível no trilho lateral;
- produtos exatos distintos deixam de compartilhar falsamente o mesmo balde de
  estoque por terem grupo/cor iguais;
- IDs repetidos na URL são deduplicados antes das consultas/RPCs;
- qualquer falha de leitura do contexto interrompe o relatório, em vez de
  devolver resultado parcial como se fosse completo;
- PDF e tela identificam explicitamente a natureza de simulação atual;
- BOM alerta tamanho sem spec que contribuiu zero e normaliza cores com acento.

## Validação executada

- 220/220 testes focados do relatório, UI, compra e estoque.
- 3.179 testes da suíte completa passaram; 7 integrações condicionais ficaram
  explicitamente em `skip` (a paridade real foi executada à parte na auditoria).
- Typecheck canônico: `bunx tsc -p tsconfig.app.json --noEmit`.
- Build de produção concluído.
- Design tokens e nomes acessíveis: nenhuma regressão nova.
- As três migrations da auditoria compilaram e executaram seus self-tests no
  schema real dentro de transações encerradas com `ROLLBACK`.
- Conferido após o teste: nenhuma função, tabela, OC, migração ou alteração de
  saldo permaneceu no banco de produção.

## Estado de entrega

As mudanças estão preparadas no workspace. As migrations **não foram aplicadas
em produção** durante a auditoria. Até o deploy, a produção continua com os
riscos e divergências descritos acima.
