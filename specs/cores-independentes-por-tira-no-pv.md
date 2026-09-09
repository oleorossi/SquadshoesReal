# Cores independentes por tira no Pedido de Venda

## Goal

Permitir que modelos com tiras, como o I91, definam na ficha técnica quais
posições seguem a cor principal do item e quais recebem uma cor independente no
Pedido de Venda. A escolha por posição deve chegar, sem ambiguidade, ao consumo,
à demanda, à reserva e ao débito do material correto.

## Background / Problem

Cada posição de tira já possui identidade técnica estável
(`technical_strap_line_id`), medida e consumo próprios. O item do PV também já
armazena uma linha de snapshot para cada tira. Entretanto, o contrato atual
acopla a cor à origem:

- `reference_base` significa tira interna e força todas as posições a herdarem
  `sale_order_items.color`;
- `finished_product_group` permite cor própria, mas significa produto acabado
  comprado pronto.

No I91, TIRA 1, TIRA 2 e TIRA 3 são tiras internas do mesmo tipo, porém podem
usar cores diferentes. Classificá-las como compradas prontas apenas para liberar
o seletor mudaria incorretamente o material, a origem e o débito. A política de
cor precisa ser independente da identidade/origem da tira.

## Scope

### In scope

- Configuração da política de cor em cada linha de tira da ficha técnica.
- Seleção de cor por posição no PV desktop e no novo PV mobile.
- Persistência da política e da cor escolhida no snapshot do item.
- Resolução canônica da napa-base, variante de tira, receita, demanda, consumo,
  reserva e débito usando a cor de cada linha.
- Compatibilidade com fichas e PVs existentes.
- Ficha de operador de Aviamento com a sequência técnica e as cores por
  posição a partir do snapshot já persistido.
- Impressão/apresentação das cores por posição nos demais artefatos existentes.
- Testes TypeScript e contratos SQL para o fluxo completo.

### Out of scope (explicitly not now)

- Escolher uma família/grupo-base diferente por tira. A peculiaridade muda
  somente a cor; o grupo-base continua vindo da ficha/variante da referência.
- Criar combinações comerciais predefinidas ou reaproveitar
  `sheet_catalog_models` como fonte do pedido.
- Alterar rendimento, medida ou consumo da tira no Pedido de Venda.
- Alterar a regra das tiras compradas prontas.
- Reescrever snapshots de PVs já aprovados, em produção ou históricos.
- Reconciliar débitos históricos.

## Requirements

1. Cada objeto de `technical_sheets.strap_colors` deve possuir a política
   canônica `color_mode`, com valores `follow_main` ou `select_on_order`.
2. A ausência de `color_mode` deve ser normalizada de forma retrocompatível:
   `reference_base` equivale a `follow_main` e `finished_product_group` equivale
   a `select_on_order`.
3. `follow_main` só é válido para `reference_base`; uma tira comprada pronta
   continua obrigatoriamente com cor selecionada no pedido.
4. A ficha técnica deve permitir escolher, em cada linha de tira, entre
   **Segue a cor principal** e **Selecionar no pedido**.
5. Alterar `color_mode` não pode trocar nem regenerar o
   `technical_strap_line_id`.
6. Clonar uma ficha deve clonar a política, mas continuar gerando novos UUIDs
   técnicos para as linhas clonadas, como já ocorre hoje.
7. Ao selecionar uma referência no PV, o snapshot deve copiar da ficha a
   política, identidade, medida, consumo e UUID de cada linha.
8. Para `follow_main`, desktop e mobile devem manter o comportamento atual:
   mostrar a cor principal como somente leitura e sincronizá-la quando a cor
   principal ou a variante de material mudar.
9. Para `select_on_order`, desktop e mobile devem exibir um seletor obrigatório
   em cada posição, inclusive quando a linha usa `reference_base`.
10. O seletor de uma tira interna deve listar apenas cores canônicas válidas do
    grupo-base efetivo daquela referência/variante; texto livre não é aceito.
11. Trocar a cor principal deve atualizar somente linhas `follow_main`; cores
    de linhas `select_on_order` devem permanecer.
12. Trocar referência ou variante deve limpar, com indicação visível, qualquer
    seleção independente que não pertença ao novo grupo-base. O PV não pode ser
    salvo até a nova seleção ser válida.
13. A política estrutural é autoritativa na ficha. O servidor deve reidratá-la
    pelo `technical_strap_line_id` e não confiar em um `color_mode` adulterado no
    payload do PV.
14. Para cada linha `reference_base`, o writer atômico deve resolver o material
    pela combinação **grupo-base efetivo + `color_id` daquela linha**. Apenas
    linhas `follow_main` usam o `color_id` derivado da cor principal.
15. A criação/edição deve ser atômica: se uma das cores estiver ausente,
    inválida, sem SKU-base oficial ou sem cadastro operacional necessário, o PV
    inteiro deve falhar com mensagem que identifique item e posição da tira.
16. `strap_sourcing` deve continuar indexado por `technical_strap_line_id` e
    guardar a variante/receita/cor correspondente àquela linha.
17. O preview e `sale_order_strap_demands` devem gerar uma contribuição lógica
    por posição, mesmo quando duas posições compartilham tipo, medida ou SKU.
18. Cores diferentes devem resolver variantes/produtos-base diferentes. Duas
    posições com a mesma base, medida e cor podem compartilhar a variante física,
    sem perder demandas e reservas individualizadas.
19. Consumo de cada tira continua sendo calculado em cm por pé/par conforme a
    ficha e convertido uma única vez para metros, sem perda de corte.
20. Agregações de consumo podem consolidar somente linhas que resolvam o mesmo
    produto físico e a mesma cor; nunca podem colapsar cores diferentes.
21. Reserva e débito devem usar a demanda exata da posição. Nunca selecionar a
    primeira reserva apenas por OP + produto.
22. Na falta de estoque ao finalizar a OP, permanece a regra canônica:
    debitar até o disponível e registrar `pending_reconciliation`, sem bloquear
    a finalização e sem cancelar silenciosamente a reserva.
23. Reabrir ou copiar um PV editável deve preservar as cores independentes e
    recalcular apenas o sourcing. Um PV comprometido mantém seu snapshot
    histórico, mesmo que a ficha seja alterada depois.
24. Na ficha de operador, a etapa **Aviamento** deve listar TIRA 1, TIRA 2,
    TIRA 3 etc. na mesma sequência da ficha técnica/snapshot, mostrando em cada
    posição a cor efetivamente selecionada no PV. Isso vale para a ficha rica e
    para o atalho legado de impressão. Linhas iguais não podem ser agrupadas de
    modo a perder a sequência.
25. Etiquetas e telas de consumo devem exibir as posições com as cores presentes
    no snapshot do item.
26. O fluxo existente de cabedal + tiras deve continuar permitido; esta mudança
    não pode restaurar a antiga exclusão mútua.
27. A detecção/mesclagem de itens duplicados deve considerar a combinação
    `technical_strap_line_id + color_id + color_mode`. Dois itens I91 com a mesma
    cor principal, mas combinações de tiras diferentes, nunca podem ser mesclados.

## Data model / Domain

### Linha técnica (`technical_sheets.strap_colors[]`)

```ts
interface TechnicalStrapLine {
  technical_strap_line_id: string;
  identity_basis: 'reference_base' | 'finished_product_group';
  identity_group_id: string | null;
  strap_type_id: string;
  measure_id: string;
  color_mode: 'follow_main' | 'select_on_order';
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
}
```

`color_mode` não faz parte da identidade da posição. Alterá-lo preserva o UUID.
Não é necessária uma nova coluna relacional: a propriedade vive no JSONB já
versionado pela ficha.

### Snapshot comercial (`sale_order_items.strap_colors[]`)

O snapshot carrega a mesma política autoritativa e, por linha, `color` e
`color_id` efetivamente escolhidos. `color_id` é sempre UUID canônico antes da
confirmação/promoção do PV.

### Identidade física

A variante física interna continua sendo identificada por:

```text
measure_id + base_group_id + color_id
```

A contribuição comercial continua identificada por:

```text
sale_order_item_id + technical_strap_line_id
```

Logo, três posições do I91 podem ter a mesma medida e três cores, gerando três
contribuições e três resoluções físicas. Duas posições com a mesma cor podem
compartilhar a variante, mas não a identidade da demanda.

### Migration implied

Uma migration deve atualizar conjuntamente os helpers/writers/guards de tiras
internas e os previews que hoje derivam um único `color_id` da cor principal.
Qualquer função `SECURITY DEFINER` recriada deve manter `search_path`, checagem
de autorização, `REVOKE` de `PUBLIC`/`anon` e os grants existentes.

## User flows

### Happy path — configurar o I91

1. Engenharia abre a ficha I91 e mantém **Habilitar tiras neste modelo**.
2. Configura TIRA 1, TIRA 2 e TIRA 3 com a mesma família/medida e seus consumos.
3. Em cada uma, escolhe **Selecionar no pedido**.
4. Salva e publica a ficha; os UUIDs das posições permanecem estáveis.

### Happy path — lançar o PV

1. Vendas adiciona o I91 e escolhe cor principal, grade e variante.
2. A seção **Cores das Tiras** mostra um seletor para TIRA 1, TIRA 2 e TIRA 3.
3. Vendas escolhe, por exemplo, TIRA 1 PRETO, TIRA 2 OFF WHITE e TIRA 3 DOURADO.
4. O cliente valida cada seleção contra o grupo-base efetivo.
5. O writer atômico revalida a política pela ficha, resolve cada cor por UUID e
   grava item, sourcing e intenções na mesma transação.
6. Preview, consumo, reserva e débito permanecem separados pelas três cores.
7. A ficha de operador de Aviamento lista as posições na sequência técnica e
   mostra PRETO, OFF WHITE e DOURADO ao lado das respectivas tiras.
8. Os demais artefatos existentes exibem a mesma sequência e as cores.

### Fluxo misto

- Uma ficha pode ter TIRA 1 `follow_main`, TIRA 2 `select_on_order` e TIRA 3
  `select_on_order`.
- Trocar a cor principal atualiza apenas TIRA 1.
- TIRA 2 e TIRA 3 conservam as escolhas enquanto forem válidas no grupo-base.

### Alternate / edge flows

- Ficha antiga sem `color_mode` → todas as tiras internas continuam seguindo a
  cor principal, sem mudança operacional.
- Tira comprada pronta → mantém seletor e débito do SKU acabado; não movimenta
  napa-base.
- Cor independente sem SKU/receita válida → bloqueio atômico e mensagem
  acionável; nenhuma parte do PV é persistida.
- Alteração posterior da ficha → pedidos novos recebem a nova política; pedidos
  comprometidos mantêm o snapshot histórico.

## Edge cases & failure modes

- **Cor independente vazia** → destacar a posição e bloquear salvar/confirmar.
- **`color_id` não pertence ao grupo-base** → limpar seleção ao detectar a troca
  de variante; servidor também rejeita payload forjado.
- **Payload tenta mudar `color_mode`** → servidor substitui pela política da
  ficha antes de validar/resolver.
- **Duas posições com a mesma cor** → duas demandas lógicas; a variante física
  pode ser compartilhada.
- **Dois itens com combinações diferentes** → não são duplicatas, ainda que
  referência, cor principal, variante e quantidade de fichas coincidam.
- **Três cores com mesmo rótulo por alias** → canonicalizar por UUID; não criar
  produtos duplicados por grafia.
- **Linha removida/reordenada na ficha** → reconciliar por
  `technical_strap_line_id`, nunca pelo índice ou rótulo.
- **Cache/offline mobile antigo** → ausência da política recebe o default
  retrocompatível; payload novo conserva política e `color_id` por linha.
- **PV comprometido** → não propagar mudanças da ficha nem limpar uma cor
  histórica; mostrar como snapshot.
- **Estoque parcial** → manter reserva/débito individual e reconciliação
  pendente por demanda.

## Constraints & assumptions

- Stack atual: React, TypeScript loose, React Query, Supabase/Postgres e Bun.
- `technical_strap_line_id` é a única identidade estável da posição.
- A mudança é somente de cor; grupo-base, medida e consumo continuam técnicos e
  não editáveis no PV.
- `color_mode` por linha foi escolhido como padrão de produto por oferecer o
  caso I91 e modelos mistos sem alterar os modelos atuais.
- O default `follow_main` para tiras internas é obrigatório para evitar mudança
  silenciosa em fichas legadas.
- Não aplicar perda de corte.
- Não reutilizar o débito legado `debit_strap_stock`; o motor UUID canônico é a
  fonte de verdade.
- Não editar `src/integrations/supabase/types.ts` à mão.
- Migration criada pelo CLI e verificada por contratos SQL/teste de banco antes
  do deploy.
- Após edições visuais: `bun run check:tokens`; sempre executar
  `bunx tsc -p tsconfig.app.json --noEmit`.

## Open questions

Nenhuma bloqueante. Combinações predefinidas de cores podem ser avaliadas em uma
fase futura, depois que a seleção por posição estiver operacional.

## Definition of Done

- [ ] **R1–R6:** A ficha permite salvar uma mistura de políticas por linha e
  reabrir/clonar sem perder política nem identidade — verificado no I91 e por
  testes de normalização/clonagem.
- [ ] **R7–R12:** Desktop e mobile mostram seletores apenas nas linhas
  `select_on_order`, preservam seleções ao trocar cor principal e invalidam
  seleção incompatível ao trocar variante — verificado por testes de componente
  e fluxo manual.
- [ ] **R13–R16:** Payload adulterado não muda a política e cada linha interna é
  resolvida por grupo-base + seu próprio `color_id` dentro do writer atômico —
  verificado por contrato SQL e chamada transacional de teste.
- [ ] **R17–R21:** Um item com três tiras iguais e cores PRETO/OFF WHITE/DOURADO
  gera três demandas por UUID; preview/consumo separam as cores e
  reserva/débito alcançam os produtos corretos — verificado por teste de banco e
  paridade do relatório canônico.
- [ ] **R18/R21:** Duas posições da mesma cor podem compartilhar variante física
  sem perder duas demandas/reservas — verificado por cenário dedicado.
- [ ] **R22:** Estoque insuficiente continua gerando débito parcial +
  `pending_reconciliation`, sem impedir finalização — suíte de débito permanece
  verde.
- [ ] **R23–R25:** Reabertura/cópia/impressão preservam as escolhas por posição;
  a ficha de operador de Aviamento conserva a sequência técnica e mostra a cor
  de cada tira; snapshots comprometidos não mudam após editar a ficha.
- [ ] **R26:** Testes de coexistência cabedal + tiras permanecem verdes.
- [ ] **R27:** Detecção e merge de duplicatas distinguem combinações por posição,
  mas reconhecem como equivalente a mesma combinação recebida em outra ordem.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit`, testes focados,
  `bun run check:tokens` e a suíte integral `bun run test` passam.
- [ ] Migration aplica do zero, mantém ACL das funções privilegiadas e os
  advisors/checagens de segurança não introduzem alerta novo.
