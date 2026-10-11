# Tira = material de estoque (como o solado)

> Spec fechada por entrevista com o dono em 11/10/2026 (grill + /spec).
> **Vence**, onde divergir: [`tiras-fluxos-por-origem.md`](tiras-fluxos-por-origem.md)
> (Revisão 3) e [`tiras-redesenho.md`](tiras-redesenho.md) (Revisões 1 e 2).
> **Amplia** [`integracao-estoque-pv-compras.md`](integracao-estoque-pv-compras.md):
> as tiras deixam de ser exceção ("Tiras artesanais continuam no ledger próprio" e
> "Fora de escopo: mudar o ledger de tiras" deixam de valer).
> Continuam valendo: `tira-base-napa-por-ficha-tecnica.md` (napa-base pela ficha, nunca o
> dublado), `calculadora-tiras-cortes-parciais.md`, e as regras de cor multicolor (Q20–Q27
> de `tiras-redesenho.md`) **mais a napa por tira (N1–N10, grill 11/10/2026)**: na multicolor
> cada tira escolhe napa + cor entre as napas da referência, e a chave do SKU (R2) usa a napa
> **da tira**, não a do item. Ao reescrever o writer/resolvedor, preserve o ramo
> `napas_da_referencia_por_tira_20270101035700` de `private.resolve_technical_strap_material`.

## Goal

A tira passa a ser um material de estoque como qualquer outro, igual ao solado. A ficha
diz qual tira e quantos metros por par. O PV empenha o SKU da tira e registra a falta. A
falta vira compra ou produção, conforme a origem cadastrada no grupo de estoque da tira.
Nenhum cadastro do Hub de Tiras é pré-requisito para salvar um PV. Junto, o "Duplicar
para lojas" passa a avisar os problemas **antes** de confirmar, e não loja por loja no fim.

## Background / Problem

Sintoma que abriu o trabalho (11/10/2026): "Duplicar para lojas" do **PV-00148**
(LNG 10, faturado) para **A C DE OLIVEIRA CALCADOS** falhou com
*"O pedido NÃO foi salvo. Tira comprada pronta nao possui variante comercial ativa exata"*.

Causa medida:
- Os 12 itens do PV-00148 aparecem como "NL02×6, NL03×3, NL04×3", mas os 6 "NL02" estão em
  **duas fichas com o mesmo código NL02**: `dee92bd6…` (nome **NL01**, 3 tiras, 12 itens de
  PV) e `517c060c…` (nome NL02, 1 tira, 9 itens).
- Os itens OFF WHITE e PRETO da ficha `517c060c` usam STRASS 6MM nas cores "OFF WHITE" e
  "PRETO COM FUNDO PRETO". O writer do PV (`prepare_sale_order_item_internal_straps`)
  exige uma `artisanal_strap_variants` ativa em (medida, grupo, cor). O grupo STRASS 6MM
  só tem variante em CRISTAL COM FUNDO BRANCO e ROSADO COM FUNDO ROSADO. Para PRETO e
  OFF WHITE existe o **produto** no estoque, mas não a variante.
- O PV-00148 é de agosto, de antes dessa regra; a cópia leva as cores antigas e o
  servidor recusa. O erro não diz qual item nem qual tira, e o diálogo só descobre na hora
  de salvar.
- O produto "TIRA STRASS 6MM / OFF WHITE" (`4a60b9c5…`) é legado: estoque 0, nenhuma
  movimentação, nenhuma reserva aberta, sem BOM. Na prática, o strass OFF WHITE **é** o
  CRISTAL COM FUNDO BRANCO (decisão do dono).

Problema de fundo (palavras do dono): *"o Hub de tiras está dando confusão demais, quando
deveria ser simples. Eu cadastro o tipo de tira e a metragem utilizada na ficha técnica; na
geração do pedido de venda é calculado o quanto aquilo irá consumir, e aquilo realiza o
débito de estoque. Quando não realizar o débito de estoque, irá funcionar como o solado."*

Hoje a tira tem motor próprio: variantes, receitas versionadas com aprovação, perfis de
largura, designação de SKU oficial por cor, demandas por save e intents. O motor de
empenho/falta (`20270101035100`) exclui tiras de propósito ("nunca tiras"). Três revisões
de spec em 24h mudaram as origens.

Dados medidos em 11/10/2026:
- Grupos de tira e SKUs ativos: Meia Cana 10mm (12), Tira chata 25mm (6), Tira chata 8mm (25),
  TIRA CHATA COSTURADA 11MM (19), TIRA OVERLOCK 5MM (33 SKUs / 25 cores), TIRA STRASS 15MM (3),
  TIRA STRASS 6MM (4), TRANÇA (8). Os nomes seguem `MEDIDA · NAPA · COR`.
- O grupo **"Tira chata 8mm" mistura três tiras**: 5 mm (Fábrica, R$ 0,10/m), 7 mm
  ("ELÁSTICO FORRADO 7 mm", Prestador, R$ 0,10/m) e 8 mm (Prestador, R$ 0,32/m). Há fichas
  que apontam a medida 5 mm com esse grupo e outras com "TIRA OVERLOCK 5MM".
- Hoje origem e R$/m do prestador vivem em `artisanal_strap_measures`
  (`origem_padrao`, `preco_prestador_per_m`). O rendimento vive em `artisanal_strap_recipes`.

## Scope

### In scope
- Modelo de tira como material de estoque: chave do SKU, origem, rendimento e R$/m no
  grupo de estoque; o PV empenha/registra falta da tira no motor genérico.
- Fluxo da falta por origem: Comprar pronto (compra), Fábrica (Ateliê "Produzido"),
  Prestador (Ateliê: OC da napa + OS, depois "Recebido").
- Aba **Tiras** no Ateliê.
- Baixa física da tira ao iniciar o setor **Aviamento** (setor de consumo da tira na ficha).
- Custo do par com tira = metros × custo do SKU; custo do SKU atualizado na entrada.
- Separação dos grupos que misturam medidas (um grupo por tipo de tira).
- Migração dos PVs abertos e das fichas.
- Remoção do Hub de Tiras do menu e **DROP** das tabelas do motor antigo (com export CSV antes).
- "Duplicar para lojas": checagem prévia por lote.
- Dados pontuais: desativar o SKU legado STRASS OFF WHITE; ficha `dee92bd6` passa ao código
  **NL01**.
- Atualizar `CLAUDE.md` (seções de tira) e marcar specs substituídas.

### Out of scope (explicitly not now)
- Etapa 2 de `integracao-estoque-pv-compras.md` (OC agrupada por grupo econômico, tela de
  rateio editável, aba Rastreio). A tira usa o caminho de compra **que existir** no momento
  da build (hoje: outbox `process_sale_order_purchase_shortages` → OC por PV
  `pendente_aprovacao`).
- Unificar as duas fichas NL02 num modelo só (o dono decidiu que são modelos diferentes).
- Mudar as regras de cor multicolor da ficha/PV (Q20–Q27 de `tiras-redesenho.md`).
- Reconciliar PVs faturados/cancelados.
- Estoque mínimo de tira (removido do sistema em `remover-estoque-minimo.md`).
- As 38 OS antigas de prestador (já tratadas em Q34/R13).

## Requirements

### R-Modelo (identidade e cadastro)
1. **Um grupo de estoque = um tipo de tira.** Grupo de tira não pode conter mais de uma medida.
2. **Chave do SKU da tira:** tira com napa-base = **grupo da tira + napa-base + cor
   canônica**; tira sem napa (ex.: strass) = **grupo + cor canônica**. A chave não depende
   da origem.
3. A janela do grupo de estoque (`GroupEditDialog`, porta única) ganha, para grupos de tira:
   - **Origem**: `Comprar pronto` | `Fábrica` | `Prestador`;
   - **Rendimento** (m de tira por m de napa), **por napa-base**: lista napa → número, digitado à mão;
   - **Mão de obra prestador (R$/m)**: um valor por grupo.
4. A linha de tira da ficha técnica referencia o **grupo** da tira (mais napa e política de
   cor/material, como hoje) e os cm/par por numeração. Ela deixa de depender de medida,
   variante, receita e `identity_basis` para funcionar.
5. ~~Setor de consumo da tira na ficha, padrão Aviamento.~~ **Revisado na implementação
   (11/10/2026):** o setor de consumo é só apresentação desde `20270101015500` — nenhum
   resolvedor lê `component_consumption_sectors`, e `resolve_consumption_sector` já cai em
   `Aviamento` para tira. Não há chave nova a criar. Ver R12.

### R-PV (salvar)
6. Salvar o PV **nunca** exige variante comercial, receita, perfil de largura ou SKU
   oficial por cor do Hub.
7. Ao salvar, para cada tira de cada item, o PV resolve o SKU pela chave (R2). Se não existe
   SKU **ativo** para a chave, o PV **cria o SKU** com estoque 0, unidade `m`, no grupo da
   tira, com nome `GRUPO · NAPA · COR` (ou `GRUPO · COR` sem napa), seguindo o padrão atual
   dos nomes (mesma regra de `20270101031900`).
7a. **SKU antigo sem napa = reserva** (decisão do dono, 11/10/2026, na implementação). Para
   tira com napa-base, o resolvedor procura, nesta ordem:
   (1) SKU ativo com a chave exata (grupo + napa + cor);
   (2) SKU ativo **sem napa** do mesmo grupo e cor (os SKUs antigos, de antes do Hub —
       ex.: "Tira Overlock 5mm" NEW WHISKY, 100 m);
   (3) só então cria o SKU novo (R7).
   Motivo: os antigos têm estoque (overlock 264 m, costurada 105 m, trança 61 m em 11/10)
   e, sem isso, a cor nasceria duplicada com o estoque parado. Tira sem napa (strass) usa
   só o passo (2) como chave exata.
8. O consumo da tira é **metros** = Σ (cm/par da numeração × pares da numeração) ÷ 100, por
   SKU. O estoque de tira não tem numeração.
9. A origem do item vem do grupo. O PV pode trocar na exceção (R2 e D14 de `tiras-redesenho`
   seguem valendo).
10. Todo erro de tira ao salvar diz **modelo, cor do item e nome da tira** — nunca a string
    crua do Postgres sem contexto.

### R-Empenho / Falta / Baixa
11. A tira entra no motor genérico de empenho parcial e falta (`20270101035100`): na
    aprovação, empenhado = LEAST(necessidade, disponível livre); o resto vira **falta**
    persistida por (PV, SKU), com a mesma prioridade dos outros materiais.
12. **Revisado (decisão do dono, 11/10/2026, na implementação):** a baixa física da tira
    acontece **onde os outros materiais baixam** — na separação (picking) do PV e, o que não
    foi separado, na finalização da OP (`settle_open_reservations_for_order`). A premissa
    original ("mecanismo de baixa por setor existente") era falsa: a baixa no início de setor
    foi desligada de propósito em `20270101015500`, e a autochecagem
    `baixa_por_entrada_no_setor_desativada` trava isso. Não religar.
13. Qualquer entrada de tira (compra, Produzido, Recebido, ajuste, inventário) quita a falta
    pelo caminho genérico de quitação.
14. Cancelar/alterar o PV libera/recompõe o empenho e a falta da tira pelo caminho genérico.

### R-Origem: destino da falta
15. **Comprar pronto:** a falta entra no caminho de compra dos outros materiais. Tira sem
    fornecedor ou sem preço **não bloqueia** o PV (R10 de `tiras-redesenho` segue).
16. **Fábrica:** a falta aparece na aba **Tiras** do Ateliê, por PV. A ação **"Produzido"**,
    num passo só:
    - o operador informa os metros de tira produzidos (vem a falta) e os metros de napa
      usados (vem falta ÷ rendimento; editável);
    - baixa a napa, dá entrada na tira e quita a falta do PV.
17. **Prestador:** a falta aparece na aba Tiras do Ateliê, por PV.
    - O botão **"Gerar OC da napa e OS"** cria, em rascunho:
      - a OC da napa no fornecedor de napa, com **entrega no prestador** e metros = falta ÷ rendimento;
      - a OS de mão de obra com R$/m do grupo (trocável na OS em rascunho).
      Nenhuma das duas mexe no estoque da fábrica (Q30).
    - Em **"Recebido"**, o operador informa os metros de tira recebidos: entram no SKU e
      quitam a falta. O que não veio continua como falta aberta.
18. **Sem rendimento** para (grupo, napa): o PV salva e empenha normalmente. No Ateliê, o item
    mostra "informe o rendimento" com um campo para digitar ali (grava no grupo). Enquanto
    isso, "Produzido" e "Gerar OC da napa e OS" ficam desabilitados.
19. A OP **não** reserva nem debita napa de tira (Q36 segue).

### R-Custo
20. O custo da tira no par = metros por par × **custo médio do SKU**. O custo do SKU é
    atualizado na entrada:
    - Comprar = preço da OC;
    - Prestador = (napa da OC + mão de obra da OS) ÷ metros recebidos;
    - Fábrica = custo da napa usada ÷ metros produzidos.
    O cálculo especial de custo de tira (napa + mão de obra por receita) sai.

### R-Migração
21. **Separar grupos mistos:** cada medida vira seu próprio grupo (ex.: SKUs 7 mm →
    "ELÁSTICO FORRADO 7MM"; 5 mm → "TIRA OVERLOCK 5MM"; 8 mm ficam em "TIRA CHATA 8MM"). As
    linhas da ficha são reapontadas pela medida. Medida ambígua vai para a **lista de
    pendências**, sem chute.
22. Origem e R$/m do prestador de `artisanal_strap_measures` são copiados para os grupos.
    O rendimento confirmado das receitas aprovadas é copiado para o rendimento por napa do
    grupo. Rendimento ausente fica vazio (R18).
23. **PVs abertos** (aprovados e em produção) são recalculados: empenho do SKU da tira + falta;
    as reservas antigas de tira são liberadas. Tira já baixada **não** é baixada de novo. PV
    com OS de prestador em andamento vai para a **lista de pendências** na tela, em vez de
    gerar falta automática (para não comprar duas vezes). Faturados e cancelados não são tocados.
24. Antes de aplicar, um **relatório de simulação** lista, por PV aberto: empenho, falta e
    pendências que a migração vai gerar.

### R-Limpeza
25. A "Central de Tiras" (Hub) **sai do menu**. A rota antiga redireciona para Estoque → Grupos.
26. As tabelas, funções, views e gatilhos do motor antigo de tira (variantes, receitas, perfis
    de largura, SKU oficial por cor, demandas de tira e clocks, intents, lotes/recebimentos/
    capacidade/conciliação/migração de tira, `artisanal_strap_measures` e o legado
    `artisanal_recipes`) são **apagados** nesta entrega. Antes do DROP, cada tabela com linhas
    é exportada em **CSV para o Google Drive** (D17). O inventário exato vem da varredura de
    `pg_proc`, `pg_views` e `pg_trigger`, não só de arquivos.
27. Nenhum código em `src/` importa ou consulta o que foi apagado (`bunx tsc` + grep limpos).

### R-Duplicar para lojas
28. Antes de **"Duplicar tudo"**, o diálogo roda uma **checagem prévia por lote** (os itens são
    os mesmos para todas as lojas do lote) e lista, por item e tira:
    - **(a) pendência de cor/material** (as de `copyStrapLinesForNewOrder`): **bloqueia** a
      confirmação até resolver;
    - **(b) "vai criar SKU novo: <nome>"**: aviso que **não bloqueia**. Oferece trocar a cor
      daquela tira para uma cor que já tem SKU ativo (mesmo grupo e napa). A troca vale para
      aquele item em todas as lojas do lote. Sem troca, o operador confirma e o SKU é criado.
29. A checagem prévia usa uma função **somente-leitura do servidor** que espelha a resolução de
    SKU do writer (R7). É a mesma fonte para a tela e para o save, sem regra duplicada no cliente.
30. "Copiar p/ novo PV" continua usando a mesma função de cópia (R-Cópia de `tiras-redesenho`).

### R-Interino (decisão do dono, 11/10/2026, na implementação)
34. **A virada substitui o ajuste interino** [`tira-comprar-pronto-so-registra.md`](tira-comprar-pronto-so-registra.md)
    (construído em paralelo por outra sessão):
    - o writer e o gatilho do PV passam a ser os do modelo novo (Comprar pronto → SKU +
      empenho/falta → OC automática, R7/R11/R15);
    - a tela **"Compras → Tiras para comprar"** sai do menu;
    - metros já marcados **"comprado"** naquela tela entram como **compra em andamento** do
      PV × SKU: a OC automática desconta esse valor, para a mesma tira não ser comprada
      duas vezes. Quando a mercadoria entra, a quitação genérica (R13) cobre a falta.

### R-Dados pontuais
31. Desativar o produto `4a60b9c5-eacd-4cd8-82de-b8176ee217b2` ("TIRA STRASS 6MM", cor
    OFF WHITE). Histórico intacto.
32. Ficha `dee92bd6-643d-4651-818e-f2a75cfabf13` (nome "NL01"): `code` de NL02 → **NL01**.

### R-Documentação
33. Atualizar `CLAUDE.md`:
    - reescrever a seção *"Tiras artesanais no PV — cadastro derivável vs dado do dono"* e a
      subseção *"Napa-base elegível"*;
    - registrar a regra nova e a armadilha de grupo misto.
    Marcar `tiras-fluxos-por-origem.md` e `tiras-redesenho.md` com o que esta spec substitui.

## Data model / Domain

- **`product_groups`** (grupo de tira): + `strap_origin` (`comprar_pronto` | `fabrica` |
  `prestador`), + `strap_labor_cost_per_m` (R$/m, numeric, nullable), + rendimento por napa
  (tabela filha `(strap_group_id, napa_group_id, yield_m_per_m)` ou jsonb; decisão de
  implementação, mas editado só pela janela do grupo). A forma de marcar "grupo é de tira" é
  decisão de implementação (sem lista fixa por nome).
- **`products`** (SKU da tira): unidade `m`; a identidade (grupo, napa, cor) precisa ser
  resolvível sem variante (coluna da napa-base no produto ou equivalente). Cor canônica via
  `resolve_strap_canonical_color_id`.
- **`technical_sheets.strap_colors`** (linha da ficha): `id` estável, `label`, `group_id`,
  política de cor (`follow_main` | `select_on_order`), política de material (napa),
  `consumption_per_size` (cm/par). Sem dependência de `measure_id`/`identity_basis` para operar.
- **`technical_sheets.component_consumption_sectors`**: + chave `tira` (padrão `Aviamento`).
- **Empenho/falta**: as mesmas estruturas de `20270101035100`, agora incluindo SKUs de tira.
- Unidades: tira em `m`; consumo da ficha em cm/par ÷ 100; napa em `m` (linear).
- Migrations: várias (modelo, migração de dados, writer, motor, DROP). O carimbo segue
  as duas fontes do `CLAUDE.md`.

## User flows

### Happy path — PV com strass comprado pronto
1. Vendedor cria o PV com NL02 PRETO; a tira 1 é STRASS 6MM em PRETO COM FUNDO PRETO.
2. Salvar: o writer acha o SKU "Tira Strass 6mm Preto com fundo preto" e salva, sem Hub.
3. Aprovar: empenha o que tem (0 m), registra falta de N m, e a compra segue o caminho genérico.
4. Mercadoria entra, a falta é quitada e vira empenho.
5. O Aviamento inicia e baixa os metros de strass.

### Fábrica — Overlock 5 mm
1. PV aprovado com falta de 30 m de "TIRA OVERLOCK 5 mm · GLOW METALIC · PRATA".
2. Ateliê → aba Tiras: aparece o PV com 30 m. "Produzido" vem com 30 m de tira e
   30 ÷ rendimento m de napa.
3. Confirmar: baixa a napa, entram 30 m de tira e a falta zera.

### Prestador — Tira chata 8 mm
1. PV aprovado com falta de 50 m.
2. Ateliê → aba Tiras → "Gerar OC da napa e OS": OC da napa (entrega no prestador) e OS em rascunho.
3. Dono revisa e envia as duas.
4. Volta a tira: "Recebido" com 48 m. Entram 48 m e quitam a falta; 2 m continuam em falta.

### Duplicar para lojas — PV-00148 → A C DE OLIVEIRA
1. Abrir "Duplicar para lojas" no PV-00148, Lote 1 com A C DE OLIVEIRA e os 12 itens.
2. A checagem prévia mostra:
   - "NL02 / OFF WHITE, TIRA 1: vai criar SKU novo TIRA STRASS 6MM · OFF WHITE", com a opção
     de trocar → o operador escolhe CRISTAL COM FUNDO BRANCO;
   - NL02 / PRETO resolve para o SKU existente, sem aviso.
3. "Duplicar tudo" cria o PV Rascunho da A C DE OLIVEIRA.

### Alternate / edge flows
- PV troca a origem de uma tira na exceção → a falta vai para o destino da origem trocada.
- PV alterado depois de aprovado → empenho e falta recompostos pelo caminho genérico.
- PV cancelado → empenho de tira liberado, falta zerada.

## Edge cases & failure modes

- Cor da tira sem SKU ativo → cria SKU (R7); na duplicação, avisa antes (R28b).
- Cor que não é canônica/ativa → erro com modelo/cor/tira (R10); o SKU não é criado.
- Grupo de tira sem origem cadastrada → assume `Comprar pronto` e mostra aviso na aba Tiras e na
  janela do grupo. *(assumido: a origem é obrigatória para destinar a falta; o padrão evita
  travar o PV, conforme R6.)*
- Sem rendimento → R18.
- "Produzido" com napa insuficiente no estoque → recusa com mensagem (físico nunca < 0).
- "Recebido" com mais metros que a falta → o excedente entra como estoque livre.
- Mesma cor em duas napas → SKUs diferentes (R2), sem fusão.
- Ficha apontando medida ambígua na migração → lista de pendências (R21).
- PV com OS de prestador em andamento → pendência, não falta (R23).
- Tira já baixada em PV em produção → não baixa de novo (R23).
- DROP de tabela com dependente → a varredura de `pg_views`/`pg_proc`/`pg_trigger` acha antes;
  nada com `CASCADE` cego (lição do `check_grade_quantity_coherence`).

## Constraints & assumptions

- Stack e regras do `CLAUDE.md`: Bun; `bunx tsc -p tsconfig.app.json --noEmit`; tokens de
  design; sem `lucide-react`; migrations via MCP com carimbo pelas duas fontes; verificar o
  objeto no banco, não o arquivo.
- Perda de corte **não existe** (não reintroduzir).
- Físico nunca < 0 (trava existente).
- Rota nova/alterada segue `ProtectedRoute → Suspense → RouteGuard`.
- **Entrega única** ("tudo de uma vez", decisão do dono), com o relatório de simulação (R24)
  antes de aplicar a migração nos PVs abertos.
- Assumido: pasta do Drive para os CSVs = `SquadShoes/Backups/tiras-2026-10` (criar se não existir).
- Assumido: nome do SKU criado segue `GRUPO · NAPA · COR` em caixa alta, como os SKUs atuais.
- Assumido: grupo de tira sem origem → `Comprar pronto` + aviso (ver edge cases).

## Open questions

- Nenhuma bloqueante. A etapa 2 da spec de integração (agrupamento de OC por grupo econômico
  e rateio editável) muda **como** a compra da tira sai, não **se** sai; esta spec segue o
  caminho que existir.

## Definition of Done

- [ ] **R1/R21** — Nenhum grupo de tira com mais de uma medida: query agrupando SKUs ativos de
      tira por grupo mostra uma medida por grupo; "ELÁSTICO FORRADO 7MM" e "TIRA CHATA 8MM"
      existem separados; fichas reapontadas; pendências listadas na tela.
- [ ] **R2/R7** — Salvar PV com tira em cor sem SKU cria o SKU (estoque 0, `m`, nome no padrão);
      salvar de novo **não** cria duplicado.
- [ ] **R3** — Janela do grupo de tira mostra e grava Origem, Rendimento por napa e R$/m.
- [ ] **R5/R12** — Ficha tem setor de consumo da tira (padrão Aviamento); iniciar o Aviamento de
      uma OP baixa os metros de tira (conferir `stock_movements`).
- [ ] **R6** — Com as tabelas do Hub vazias/apagadas, um PV com strass, overlock e tira chata
      salva sem erro.
- [ ] **R10** — Forçar cor inválida numa tira: a mensagem traz modelo, cor do item e tira.
- [ ] **R11/R13/R14** — Aprovar PV com estoque parcial de tira: empenho = estoque e falta = resto;
      dar entrada quita a falta; cancelar libera tudo (teste de contrato + query).
- [ ] **R15** — Falta de tira Comprar pronto aparece na OC gerada pelo caminho genérico.
- [ ] **R16** — Ateliê → Tiras → "Produzido" baixa a napa, dá entrada na tira e zera a falta (conferir saldos).
- [ ] **R17** — "Gerar OC da napa e OS" cria as duas em rascunho sem mexer no estoque; "Recebido"
      parcial deixa o saldo em falta.
- [ ] **R18** — Sem rendimento: PV salva; Ateliê pede o rendimento e desabilita as ações até digitar.
- [ ] **R20** — Custo do par de um modelo com tira = metros × custo médio do SKU; entrada de
      Prestador atualiza o custo do SKU pela fórmula.
- [ ] **R23/R24** — Relatório de simulação gerado e conferido antes de aplicar; depois, PVs
      abertos com empenho/falta de tira, nenhuma baixa duplicada, PVs com OS em andamento na
      lista de pendências.
- [ ] **R25/R26/R27** — Central de Tiras fora do menu (a rota redireciona); CSVs no Drive; tabelas
      do motor antigo inexistentes (`to_regclass` nulo); grep em `src/` sem referência.
- [ ] **R28/R29** — No "Duplicar para lojas" do PV-00148, a checagem prévia mostra o aviso de SKU
      novo do OFF WHITE com a troca para Cristal, e bloqueia lote com pendência de cor/material.
- [ ] **R31/R32** — SKU legado OFF WHITE inativo; ficha `dee92bd6` com código NL01; o diálogo
      mostra "NL01×3 · NL02×3".
- [ ] **R33** — `CLAUDE.md` e as duas specs antigas atualizadas.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run test`, `bun run check:tokens` verdes.
- [ ] **Verificação no site de produção** (regra 7), por agente de navegador, depois do deploy da
      Vercel em `main`: rodar "Duplicar para lojas" do **PV-00148** para **A C DE OLIVEIRA
      CALCADOS**, trocar o strass OFF WHITE para Cristal no aviso prévio e **criar o PV real**
      (Rascunho); abrir o PV criado e conferir as tiras.
