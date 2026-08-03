# PV: ida pra produção rápida + aba de Pendências

## Goal

Fazer o PV sair de "Aprovado/Em Produção" em **≤ 3 segundos** (hoje: 20 a 35s) movendo a
orquestração do navegador pra uma única função no banco, e criar a aba
**`/sales?view=pendencias`** onde toda falha de lançamento — hoje invisível ou perdida num
toast — fica registrada, classificada por severidade e retentável item a item.

Serve o dono/PCP, que hoje clica em "Em Produção", espera a tela travada por meio minuto e
**não tem como saber** se todos os itens realmente baixaram material.

## Background / Problem

Medições feitas no banco de produção (`ssvxfoybzmjlypnipqzn`) em 03/08/2026:

| Medida | Valor |
|---|---|
| PVs cadastrados | 59 |
| Itens por PV | média **5,5** · máximo **12** |
| OPs ativas | 266 |
| Produtos com estoque ≤ 0 | **101 de 199 (51%)** |
| Produtos com estoque negativo | **0** |
| `useUpdateSaleOrderStatus` | **1.168 linhas, 68 `await supabase`** numa função |
| `compute_min_billing_dates` | **1.058 ms** para 58 linhas, 37.035 buffers |
| `sale_order_min_billing` (pg_stat_statements) | **1.225 s de tempo total** — a consulta mais cara do banco inteiro |

### Os quatro problemas

1. **Orquestração no cliente.** `useUpdateSaleOrderStatus`
   ([useSaleOrders.ts:754](../src/hooks/useSaleOrders.ts#L754)) faz, **por item do PV**:
   `insert orders` → `hybrid_debit_stock_for_order` → `debit_sole_stock_by_grade` →
   `debit_strap_stock` → `debit_packaging_for_order` → `insert order_stages` → MRP.
   São ~7 idas e voltas por item, em série. PV de 5,5 itens ≈ 40 chamadas; o de 12 itens
   passa de 80. A ~200–400 ms cada (Brasil → us-west-2), dá **8 a 35 s de tela travada**.

2. **Falha some da tela.** Quando o débito de um item falha, a OP é cancelada e aparece um
   `toast.warning` que desaparece em segundos
   ([useSaleOrders.ts:1273](../src/hooks/useSaleOrders.ts#L1273)). Não há registro. Ninguém
   descobre depois.

3. **Falta de estoque é silêncio absoluto.** O débito é chamado com `p_force_soft: true`,
   que baixa `LEAST(disponível, necessário)` e segue sem erro. Metade do catálogo está
   zerado e **não existe um único estoque negativo** — prova de que o grampeamento no zero
   está acontecendo em escala, sem aviso. Um PV pode ir 100% pra produção, sem nenhum erro
   na tela, com itens sem material baixado.

4. **A lista de PVs paga ~1 s por abertura** pra calcular o alerta "DATA INVIÁVEL"
   ([SaleOrders.tsx:157](../src/pages/SaleOrders.tsx#L157)). O commit `5c26627` matou o N+1
   (1.516 chamadas), mas **cada chamada ainda custa ~0,8 s** porque o motor recalcula tudo
   do zero.

5. **Salvar o PV faz ~26 idas e voltas.** A RPC atômica grava o PV numa chamada, mas logo
   depois vêm dois laços seriais de UPDATE por item — origem das tiras
   ([useSaleOrders.ts:51](../src/hooks/useSaleOrders.ts#L51)) e intenção de terceirização
   ([useSaleOrders.ts:696](../src/hooks/useSaleOrders.ts#L696)) — gravando colunas que a
   própria RPC poderia ter escrito junto.

## Scope

### In scope

- Motor server-side único para as transições **Aprovado** e **Em Produção**.
- Isolamento transacional **por item** (item que falha não derruba o PV).
- Tabela de eventos de falha + view de pendências derivadas.
- Aba `/sales?view=pendencias` com 4 segmentos, agrupada por PV.
- Retentativa por item, reingressando no lote original.
- Cache de `min_billing_date` com marcação de sujo; lista continua marcando vermelho.
- Dobrar `strap_sourcing`, `selected_terceirizacao_ids`, `terceirizacao_quantities` e
  `outsourced_sectors` para dentro das RPCs atômicas de **criar e editar** PV.
- A recriação de OPs do fluxo de **edição** passa a chamar o mesmo motor novo (não é uma
  segunda implementação).

### Out of scope (explicitamente não agora)

- Transições **Cancelado**, **Reativar** (sair de Cancelado) e **Faturado** — continuam
  exatamente como estão hoje, no cliente.
- Processamento em segundo plano / fila / worker. O clique permanece **bloqueante**.
- Barra de progresso item a item (a operação passa a ser curta demais pra justificar).
- Mudar a regra de consumo de materiais, a resolução de variante, o MRP ou o custeio.
- Corrigir o cadastro dos 101 produtos zerados. A aba **expõe**, não conserta.
- Reescrever a tela `/sales` (3.138 linhas) ou seus outros filtros.

## Requirements

Numerados, testáveis, todos "deve".

### Motor de promoção

1. Deve existir uma função no banco `promote_sale_order_to_production(p_sale_order_id uuid,
   p_target_status text)` que executa, **em uma única chamada**, tudo que hoje o navegador
   faz item a item para os status `Aprovado` e `Em Produção`.
2. A função deve iterar os itens **em série, dentro da própria transação**, ordenados por um
   critério determinístico (`sale_order_items.id`), para que duas sessões concorrentes
   travem as mesmas linhas de `products` na mesma ordem — **sem deadlock**.
3. Cada item deve rodar dentro do seu próprio bloco `BEGIN ... EXCEPTION WHEN OTHERS`
   (savepoint implícito). Uma exceção deve desfazer **apenas o trabalho daquele item** —
   OP, débitos, estágios — e permitir que os demais sigam.
4. A função deve ser `SECURITY DEFINER` **com guard de autenticação obrigatório**
   (`auth.uid() IS NOT NULL` + checagem de permissão). Sem o guard ela fica executável pela
   chave anon que vai no bundle — o mesmo furo P0 fechado em 01/08/2026.
5. A função deve retornar um JSON com o resumo: `{ ops_criadas, itens_ok[], itens_falha[],
   itens_baixa_parcial[] }`, suficiente pra montar o toast final sem uma segunda consulta.
6. O comportamento de negócio deve permanecer **idêntico** ao atual: mesma resolução de
   variante de material, mesma conversão dm²→unidade física pela largura da ficha de
   componente, mesma segmentação de solado por numeração, mesmo `p_force_soft: true`,
   mesma criação de OS de terceirização pelo trigger `tg_orders_generate_outsourcing_os`.
   Esta spec é sobre **onde** o código roda, não sobre **o que** ele calcula.
7. `useUpdateSaleOrderStatus` deve passar a chamar essa função para `Aprovado` e
   `Em Produção`; os demais status continuam pelo caminho atual, intocados.

### Registro de falhas

8. Deve existir uma tabela de **eventos** de falha, gravada pela função do banco, com no
   mínimo: PV, item do PV, tipo, `SQLSTATE`, mensagem, contexto (jsonb), quando ocorreu,
   quando foi resolvido, e contador de retentativas.
9. Os eventos gravados devem cobrir os dois tipos que são fato histórico: **erro técnico no
   débito** e **falha ao criar a OP ou seus estágios**.
10. A gravação do evento **não pode ser desfeita** pelo rollback do item. Ou seja: o item
    reverte, mas o registro da falha persiste (a função de log precisa escapar do savepoint).
    Sem isso a aba nasce vazia justamente quando mais importa.
11. Deve existir uma **view derivada** que calcula, na hora da leitura, as pendências que
    são **estado atual**, não evento:
    - **baixa parcial** — item cujo consumo planejado é maior que o efetivamente debitado,
      com o quanto faltou, por material;
    - **cadastro faltando** — reusando `consumption_consistency_report()`, que já detecta
      napa sem largura, solado sem specs, palmilha pronta inconsistente e solado fachetado
      sem consumo de fachete;
    - **data inviável** — PV cujo `delivery_deadline` é anterior ao `min_billing_date`.
12. Pendência derivada deve **sumir sozinha** quando a condição deixa de existir (deu entrada
    da napa → a linha some), sem nenhuma ação do usuário. Pendência de evento só sai quando o
    "Tentar de novo" der certo.

### Aba de Pendências

13. Deve existir a visão **`/sales?view=pendencias`**, seguindo o padrão de troca de visão
    por parâmetro de URL que a tela já usa (`?view=consumo`) — sem rota nova.
14. A aba deve mostrar **uma linha por PV**, expansível para os itens. Não uma lista plana.
15. Cada pendência deve ter uma das três severidades, e a severidade **nunca pode ser
    comunicada só por cor** (precisa de ícone + texto):
    - **Crítico** — erro técnico, OP não criada, estágios não criados. Bloqueia produção.
    - **Atenção** — baixa parcial por falta de estoque; data inviável.
    - **Informativo** — cadastro faltando.
16. A aba deve abrir mostrando **apenas o crítico**; atenção e informativo ficam atrás de
    filtro, sempre com o contador visível (nada é escondido, só não é o padrão).
17. Os 4 segmentos devem ser navegáveis: erro técnico · baixa parcial · cadastro faltando ·
    data inviável.
18. Deve haver um botão **"Tentar de novo"** por item com pendência de evento.
19. A retentativa deve criar a OP **igual às OPs irmãs do mesmo PV**: mesmo
    `planned_delivery`, mesma `billing_week`, mesmo `is_ahead_of_schedule`, mesmo
    lote/onda e mesmos estágios — como se tivesse entrado junto no dia 1. Não pode nascer
    com a data de hoje nem virar OP avulsa.
20. Quando a retentativa der certo, o evento deve ser marcado como resolvido e sair da lista
    padrão.
21. Quando a retentativa falhar de novo, o contador de retentativas deve subir e a mensagem
    de erro deve ser **atualizada**, não duplicada em linha nova.

### Data inviável / min_billing

22. Deve existir um cache persistido de `min_billing_date` por PV, com marca de "sujo".
23. Um gatilho deve marcar o PV como sujo quando mudar o que alimenta o cálculo: itens do
    PV, prazo de entrega, estoque dos materiais envolvidos, lead time de fornecedor,
    capacidade de setor.
24. A lista de PVs deve **continuar marcando a linha em vermelho**, lendo o valor gravado —
    nunca recalculando no mount.
25. Linha suja deve ser recalculada em segundo plano ou na abertura do segmento "data
    inviável", nunca no caminho crítico da lista.

### Salvar PV

26. `create_sale_order_atomic` deve passar a gravar, na mesma chamada, as colunas hoje
    escritas por UPDATE depois: `strap_sourcing`, `selected_terceirizacao_ids`,
    `terceirizacao_quantities` e `outsourced_sectors`.
27. `update_sale_order_with_teardown` deve fazer o mesmo — preservando a diferença já
    documentada no código: na **edição**, mapa vazio de `outsourced_sectors` **é gravado**
    (significa "usuário desmarcou todos os setores"), enquanto na **criação** vazio é o
    default e pode ser omitido.
28. Salvar um PV de 12 itens deve custar **no máximo 3 idas e voltas** (RPC + sync
    financeiro + invalidação), contra as ~26 de hoje.
29. A recriação de OPs do fluxo de edição
    ([useSaleOrders.ts:2164](../src/hooks/useSaleOrders.ts#L2164)) deve chamar o **mesmo**
    `promote_sale_order_to_production`, não uma cópia da lógica.

### Feedback

30. Durante a operação, o botão deve ficar **desabilitado com indicador de carregamento** —
    nunca clicável duas vezes (hoje um duplo-clique dispara duas orquestrações
    concorrentes).
31. Ao terminar, o toast deve resumir o resultado real: quantas OPs foram criadas, quantos
    itens falharam e quantos ficaram com baixa parcial, com atalho pra aba de pendências
    quando houver o que ver.
32. O toast **não pode ser o único registro** de nada — tudo que ele menciona precisa estar
    na aba. Essa é a falha central que a spec corrige.

## Data model / Domain

### Tabela nova — eventos de falha

Uma linha por ocorrência, não por condição.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `sale_order_id` | uuid FK | |
| `sale_order_item_id` | uuid FK | nulo quando a falha é do PV inteiro |
| `order_id` | uuid FK | OP criada e depois revertida, quando houver |
| `kind` | text | `erro_debito` · `falha_op` · `falha_estagios` |
| `sqlstate` | text | código do erro Postgres |
| `message` | text | mensagem original, sem reescrita |
| `context` | jsonb | referência, cor, grade, material que quebrou |
| `occurred_at` | timestamptz | |
| `resolved_at` | timestamptz | nulo = pendente |
| `retry_count` | int | default 0 |

Timestamp da migration: **maior que `20261112120700`** (topo em 03/08/2026). Reconsultar
`select max(version) from supabase_migrations.schema_migrations` na hora de aplicar — o
worktree é compartilhado e outra sessão pode ter subido o topo.

### View nova — pendências derivadas

Sem tabela. Calcula na leitura, unindo baixa parcial + `consumption_consistency_report()` +
data inviável. É o que garante o requisito 12 (some sozinho).

### Tabela nova — cache de min_billing

`sale_order_id` (pk) · `min_billing_date` · `computed_at` · `dirty`. Mesmo padrão de malha
suja que o projeto já usa no custeio.

### Sem alteração de esquema

`orders`, `sale_order_items`, `products`, `stock_grade`, `production_consumptions` e as
funções de débito **não mudam de forma**. O motor novo é um envelope que chama as funções de
débito que já existem.

## User flows

### Caminho feliz

1. Usuário abre `/sales`. A lista aparece com as linhas de data inviável já marcadas em
   vermelho (valor lido do cache, ~0 ms).
2. Seleciona um PV de 12 itens e muda o status para **Em Produção**.
3. O botão desabilita e mostra carregamento.
4. Uma única chamada vai ao banco. Lá dentro, os 12 itens são processados em série: OP
   criada, estoque debitado, solado por numeração, tira, embalagem, estágios, MRP.
5. Em **≤ 3 s** a tela volta com o toast: "12 OPs criadas".
6. As OPs aparecem no Fluxo de Produção com seus estágios.

### Um item falha

1. a 4. iguais.
5. O item 7 estoura no débito (ex.: ficha sem snapshot). O bloco de exceção desfaz **só** a
   OP e os débitos do item 7. Os outros 11 permanecem.
6. Um evento é gravado com o `SQLSTATE`, a mensagem e o contexto.
7. Toast: "11 OPs criadas · 1 item com falha" com atalho pra aba.
8. Em `/sales?view=pendencias`, o PV aparece com severidade **crítica** e o item 7 expandido
   mostra o motivo.
9. Usuário corrige a causa (cadastra o que faltava) e clica **"Tentar de novo"**.
10. A OP do item 7 nasce com o mesmo prazo, mesma semana de faturamento e mesmo lote das
    11 irmãs. O evento é marcado como resolvido e sai da lista.

### Baixa parcial (o caso invisível de hoje)

1. a 5. tudo dá "certo" — 12 OPs criadas, nenhum erro.
6. Mas 3 itens baixaram menos material do que precisavam, porque o estoque acabou.
7. Toast: "12 OPs criadas · 3 itens com baixa parcial".
8. Na aba, segmento **baixa parcial**, severidade **atenção**: cada item lista o material e
   quanto faltou.
9. Chega a compra e o usuário dá entrada da napa.
10. Na próxima abertura da aba, a linha **sumiu sozinha** — é estado derivado, não evento.

### Data inviável

1. Na lista, 3 PVs estão em vermelho.
2. O usuário abre a aba, segmento **data inviável**, e vê os 3 com a data mínima possível e
   o motivo (estoque, lead time de fornecedor ou capacidade de setor).

## Edge cases & failure modes

| Caso | Comportamento esperado |
|---|---|
| PV sem itens | Não chama o motor; avisa "PV sem itens" e não muda o status. |
| Item sem `reference_id` | Pulado silenciosamente, como hoje. Não é pendência. |
| Duplo-clique no botão de status | Segundo clique é impossível — botão desabilitado (req. 30). Ainda assim o motor deve ser idempotente: item que já tem OP ativa não gera OP nova. |
| Duas sessões promovendo o mesmo PV | A ordenação determinística do laço (req. 2) faz a segunda esperar a primeira. O `claim` de status que já existe hoje continua valendo. |
| OP em status `Rascunho` para o item | Não bloqueia a criação da OP debitada — regra já existente no código, deve ser preservada. |
| Erro no meio do laço deixa OP sem estágios | É `falha_estagios`, severidade crítica: OP sem `order_stages` **some do Fluxo de Produção**. Precisa aparecer na aba. |
| Falta de estoque total (material zerado) | **Não é erro.** Débito soft baixa 0, OP é criada, e o item vira linha de baixa parcial (atenção). Comportamento de hoje preservado. |
| Napa sem largura na ficha de componente | Consumo fica ~100× inflado. Não trava o débito; vira pendência **informativa** de cadastro. |
| Retentativa de item cujo PV já foi faturado | Bloquear. Não criar OP nova em PV faturado. |
| Retentativa de item cujo PV foi cancelado | Bloquear, e marcar o evento como resolvido por cancelamento. |
| Cache de min_billing nunca calculado (PV novo) | Linha nasce suja; a lista não marca vermelho até o primeiro cálculo. Nunca bloquear a lista esperando o cálculo. |
| PV com 0 pendências | `<EmptyState />` do projeto, não uma variação ad-hoc. |
| Falha na gravação do próprio evento | Não pode derrubar a promoção. Log e segue. |

## Constraints & assumptions

### Da arquitetura decidida na entrevista

- Clique **bloqueante**, não segundo plano.
- Transação **por item**, não por PV: item que falha não derruba os outros.
- Laço **em série** dentro do banco. Paralelismo de itens está proibido — dois itens com a
  mesma napa disputariam a mesma linha de `products`.

### Do projeto (não negociáveis)

- **Bun**, nunca `npm` (não existe nesta máquina). `bun run <script>` / `bunx`.
- Typecheck só vale com `bunx tsc -p tsconfig.app.json --noEmit`. A raiz é solution file e
  não checa nada — símbolo indefinido vira `ReferenceError` em produção.
- **Design tokens** obrigatórios na aba nova: `bg-card`, `text-muted-foreground`,
  `border-border`. Cor de status semântica no padrão `bg-red-500/10 text-red-600` (as
  variantes `-100` quebram no modo escuro). Rodar `bun run check:tokens` depois.
- Ícones de **`@phosphor-icons/react`**. Importar de `lucide-react` vira `ReferenceError`.
- Toolbar da aba em `h-9`; ações inline dentro de linha em `h-7`. Não misturar alturas na
  mesma toolbar.
- `<EmptyState />` de `@/components/ui/empty-state`.
- Notificações via **`sonner`**.
- Domínio em **pt-BR** (colunas, textos, rótulos); nomes de hook e React Query keys em
  inglês.
- Números em coluna com `tabular-nums` (quantidades e faltas precisam alinhar).
- Toda coluna nova que o motor TS passar a ler precisa entrar em
  `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` — regra load-bearing, já causou supressão virar
  no-op silencioso uma vez.
- Migration com carimbo **> `20261112120700`**, reconsultado na hora de aplicar.
- RPC `SECURITY DEFINER` **exige** guard de autenticação (P0 de 01/08/2026).

### Padrões de UI aplicados (ui-ux-pro-max)

- `color-not-only` — severidade sempre com ícone + texto, não só cor. A fábrica imprime P&B
  e há daltônicos; cor sozinha não comunica.
- `loading-buttons` — botão desabilitado com indicador durante a operação assíncrona.
- `error-clarity` / `error-recovery` — a mensagem diz a causa **e** o caminho de correção;
  "Tentar de novo" é o caminho.
- `empty-states` — estado vazio com mensagem útil, não tela em branco.
- `progressive-disclosure` — crítico primeiro, resto atrás de filtro com contador.
- Contraste mínimo 4,5:1 nos dois temas; a aba precisa funcionar em claro e escuro.

### Premissas adotadas onde não houve decisão explícita

- **Permissão:** quem já enxerga `/sales` enxerga a aba; "Tentar de novo" exige a permissão
  de edição de `/sales`. Segue `useCan('/sales')`, sem permissão nova.
- **Retenção de eventos resolvidos:** ficam gravados (viram histórico consultável), apenas
  saem do filtro padrão. Nenhuma limpeza automática nesta versão.
- **Ordem dos segmentos na aba:** erro técnico → baixa parcial → data inviável → cadastro,
  do mais bloqueante ao menos.

## Open questions

- Qual o gatilho exato de recálculo do cache de min_billing quando muda **capacidade de
  setor** (hoje o cálculo lê os 9 setores)? Marcar todos os PVs como sujos a cada mudança de
  capacidade pode ser caro — decidir na implementação se vale um recálculo em lote
  agendado nesse caso específico.
- A baixa parcial precisa comparar planejado × debitado por material. Verificar na
  implementação se `production_consumptions` já guarda o planejado com granularidade
  suficiente, ou se o número precisa vir do motor de consumo na hora da leitura.

## Definition of Done

Cada item verificável por outra pessoa, sem depender de quem construiu.

### Performance

- [ ] **Req. 1, 7** — Promover o PV de 12 itens que existe no banco para "Em Produção" leva
      **≤ 3 s**, cronometrado na aba Network do navegador (do clique até o toast).
- [ ] **Req. 1** — A aba Network mostra **uma única** chamada de promoção, não 80.
- [ ] **Req. 28** — Salvar um PV de 12 itens dispara **≤ 3** requisições ao Supabase.
- [ ] **Req. 24** — Abrir `/sales` com o cache preenchido leva **≤ 1 s** até a lista estar
      utilizável, e `pg_stat_statements` não registra chamada nova a
      `compute_min_billing_dates` no mount.
- [ ] Rodar `select mean_exec_time, calls from pg_stat_statements where query ilike
      '%min_billing%'` depois de 1 dia de uso: o tempo total não cresce como hoje
      (1.225 s acumulados).

### Correção e isolamento

- [ ] **Req. 3** — Forçando um erro artificial no item 7 de um PV de 12 (ex.: apontar
      referência sem snapshot): 11 OPs são criadas, o item 7 **não** tem OP, e
      `select * from orders where sale_order_id = '<pv>'` mostra exatamente 11 linhas ativas.
- [ ] **Req. 3** — Nesse mesmo teste, o estoque dos 11 itens **foi** debitado e o do item 7
      **não** — conferir em `stock_movements` / `products.quantity`.
- [ ] **Req. 10** — O evento de falha do item 7 existe na tabela mesmo com o item revertido.
- [ ] **Req. 2** — Promover dois PVs que compartilham a mesma napa, em duas abas ao mesmo
      tempo: ambos terminam sem deadlock e o estoque final bate com a soma dos dois débitos.
- [ ] **Req. 6** — Comparar o consumo gravado por um PV promovido pelo motor novo com o
      mesmo PV promovido pelo caminho antigo (em ambiente de teste): **valores idênticos**.
- [ ] **Req. 4** — Tentar chamar `promote_sale_order_to_production` com a chave anon, sem
      login: **negado**.

### Aba de Pendências

- [ ] **Req. 13** — `/sales?view=pendencias` abre sem rota nova e o link direto funciona.
- [ ] **Req. 14** — A aba mostra uma linha por PV, expansível; não uma lista plana.
- [ ] **Req. 15** — Cada severidade tem ícone + rótulo em texto; desligando a cor (print em
      escala de cinza) ainda dá pra distinguir crítico de atenção.
- [ ] **Req. 16** — A aba abre mostrando só o crítico, com os contadores de atenção e
      informativo visíveis.
- [ ] **Req. 11** — Com o estoque atual (51% do catálogo zerado), o segmento de baixa
      parcial lista itens reais com o material e a quantidade que faltou.
- [ ] **Req. 12** — Dar entrada do material que faltava e reabrir a aba: **a linha sumiu**,
      sem nenhuma ação de "resolver".
- [ ] **Req. 11** — O segmento de cadastro reflete o que `consumption_consistency_report()`
      retorna.
- [ ] **Req. 17** — O segmento "data inviável" lista os mesmos PVs que a lista marca em
      vermelho — os dois batem.

### Retentativa

- [ ] **Req. 18, 19** — Retentar o item 7 dois dias depois cria a OP com o **mesmo**
      `planned_delivery`, `billing_week`, `is_ahead_of_schedule` e lote das 11 irmãs.
      Verificar com `select planned_delivery, billing_week from orders where sale_order_id =
      '<pv>'` — todas iguais.
- [ ] **Req. 19** — A OP retentada tem `order_stages` e **aparece no Fluxo de Produção**.
- [ ] **Req. 20** — O evento sai da lista padrão depois da retentativa bem-sucedida.
- [ ] **Req. 21** — Retentar de novo com o problema ainda presente: `retry_count` sobe, a
      mensagem é atualizada, e **não** aparece linha duplicada.
- [ ] **Edge** — "Tentar de novo" num item de PV faturado ou cancelado é bloqueado com
      mensagem clara.

### Salvar PV

- [ ] **Req. 26** — Criar PV com origem de tira e terceirização por setor definidas: as
      quatro colunas chegam gravadas sem nenhum UPDATE extra na aba Network.
- [ ] **Req. 27** — Editar um PV **desmarcando todos os setores** de terceirização de um
      item: o mapa vazio é gravado e a desmarcação tem efeito (regressão conhecida do
      código atual).
- [ ] **Req. 29** — Editar um PV em "Em Produção" recria as OPs pelo motor novo — conferir
      que a chamada é a mesma função, não uma cópia.

### Higiene do projeto

- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo.
- [ ] `bun run lint` sem erro novo.
- [ ] `bun run check:tokens` sem violação nos arquivos novos.
- [ ] `bun run test` verde, incluindo `orderConsumption.test.ts` (guard das colunas do motor).
- [ ] A aba renderiza legível em **360 px** de largura e nos temas claro **e** escuro.
- [ ] Migration com carimbo maior que o topo do banco no momento da aplicação.
