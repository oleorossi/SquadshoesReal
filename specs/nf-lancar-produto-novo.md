# Lançar no Estoque — primeiro lançamento de produto novo a partir da NF

## Goal
Destravar e completar o fluxo **"Lançar no Estoque → Criar novo produto"** da
importação de NF de entrada, para que um item que **nunca existiu** no estoque seja
cadastrado de forma **completa** (com Cor, Fornecedor e conversão de unidade) e dê
entrada corretamente — e para que a **próxima** NF do mesmo item **bata sozinha**
(sem voltar pra PENDENTE). Serve o operador de compras/financeiro que importa XML de
NF-e.

## Background / Problem
Fluxo hoje (aba **Financeiro → Notas Fiscais → Entradas**):

1. Operador importa o XML. Cada item é comparado com `products`
   ([`matchNfItemToProduct`](src/components/suppliers/XmlImportDialog.tsx#L73) — SKU,
   nome normalizado, "NOME: COR", stripped, contains).
2. Quando **nenhum** item bate, aparece o toast azul *"NF importada com N item(ns),
   mas nenhum bateu com produtos cadastrados. Use 'Lançar no Estoque'..."*
   ([XmlImportDialog.tsx:513](src/components/suppliers/XmlImportDialog.tsx#L513)); os
   itens ficam **PENDENTE** (`added_to_stock=false`, `product_id=null`).
3. Operador clica **"Lançar no Estoque"** → abre
   [`AddToStockDialog`](src/components/suppliers/AddToStockDialog.tsx) já em modo
   **`create`** ("Criar novo produto"), pré-preenchido com Nome, SKU, Unidade,
   Categoria, Grupo.
4. Ao confirmar, estoura o erro vermelho:

   > **Erro: column "description" of relation "products" does not exist**

**Causa raiz (confirmada no banco `ssvxfoybzmjlypnipqzn`):** o modo `create` chama a
RPC `create_product_with_initial_stock`
([AddToStockDialog.tsx:247-261](src/components/suppliers/AddToStockDialog.tsx#L247))
que faz `INSERT INTO public.products (..., description, ...)`. A tabela `products`
**não tem** coluna `description` (colunas reais: `name, sku, category, color, unit,
location, group_id, quantity, unit_price, min_stock, max_stock, purchase_unit,
conversion_rate, supplier_id, active, ...`). Logo **todo** primeiro lançamento de
produto novo por NF falha e o item **nunca** sai de PENDENTE.

**Problemas adicionais (o "melhorar o fluxo"):** mesmo consertando o `INSERT`, o
produto nasce **incompleto**:
- `p_supplier_id: null` está **fixo** na chamada → produto não fica ligado ao
  fornecedor da NF.
- A RPC **não recebe `color`** → produto nasce sem cor. O desempate de match das
  próximas NFs depende de `products.color`
  ([disambiguateByColor](src/components/suppliers/XmlImportDialog.tsx#L64)); sem cor,
  itens de mesmo nome-base em cores diferentes voltam pra PENDENTE.
- A RPC **não recebe** `purchase_unit`/`conversion_rate` → se o item vier faturado em
  **embalagem** (CX/RL/FD) diferente da unidade de estoque, a próxima importação
  **bloqueia** o item (`needsConfig` em
  [convertNfToStockUnit](src/lib/nfUnitConversion.ts#L110)).

## Scope

### In scope
- **Correção do bug:** produto novo passa a ser criado com sucesso (sem referência a
  `description` em `products`).
- **Produto nasce completo** no modo "Criar novo produto":
  - **Cor** (campo opcional) → grava em `products.color`.
  - **Fornecedor** (campo) → default = fornecedor da NF; se não existir na lista,
    permitir **cadastrar inline**; grava em `products.supplier_id`.
  - **Conversão** → quando a unidade da NF (canônica) **≠** unidade de estoque
    (canônica), exibir e capturar **Unidade de compra** + **Fator de conversão**;
    gravar em `products.purchase_unit` / `products.conversion_rate`.
- **Match futuro:** garantir `sku = product_code` (código da NF) + `color` gravados,
  para a próxima NF do mesmo item bater no nível 1 (SKU) automaticamente.
- **Vínculo do item:** ao concluir, `invoice_items.added_to_stock=true` +
  `product_id` (sai de PENDENTE), como já ocorre hoje.
- **Consistência entre os caminhos** de criação de produto a partir de NF (ver
  "Constraints"): o caminho em lote e o auto-import não podem divergir do resultado
  do modo `create` (produto completo com cor/fornecedor/conversão quando possível).

### Out of scope (explicitly not now)
- **Auto-criar produtos silenciosamente** durante a importação do XML — mantém-se a
  confirmação manual (item novo → PENDENTE → operador faz "Criar novo produto"). O
  risco de adivinhar grupo/cor/conversão errados é alto.
- **Redesenho** visual do modal `AddToStockDialog` (só acréscimo de campos).
- **Índice UNIQUE em `suppliers.cnpj`** — recomendado, mas há risco de duplicatas
  pré-existentes bloquearem a criação do índice; fica como Open Question. A
  deduplicação neste spec é feita **em código** por CNPJ normalizado.
- Qualquer mudança em **Notas Fiscais de Saída**.
- Preencher `NCM`/impostos no cadastro do produto (não há colunas para isso hoje).

## Requirements
Numeradas, testáveis, todas "must":

1. **Corrigir a RPC** `create_product_with_initial_stock`: o `INSERT INTO products`
   **não** pode referenciar a coluna `description`. Após a correção, criar um produto
   pela RPC não pode retornar `column "description" ... does not exist`.
2. A RPC deve **aceitar e persistir** `color` (`products.color`), `supplier_id`
   (`products.supplier_id`), `purchase_unit` (`products.purchase_unit`) e
   `conversion_rate` (`products.conversion_rate`), além dos campos atuais.
3. A alteração da assinatura da RPC deve ser feita com **`DROP FUNCTION` da
   assinatura antiga + `CREATE` da nova + re-`GRANT`** (não criar overload
   duplicado), **preservando** `SECURITY DEFINER`, `SET search_path = public`, a
   checagem `is_approved_user()` e os GRANTs/REVOKEs de segurança vigentes
   (authenticated pode executar; anon/public não).
4. No modo **"Criar novo produto"** do `AddToStockDialog`, adicionar campo **Cor**
   (texto, opcional) e passar `p_color` para a RPC.
5. No mesmo modo, adicionar campo **Fornecedor**: default = fornecedor da NF que
   originou o item; lista os fornecedores existentes; se o fornecedor da NF não
   estiver cadastrado, permitir **cadastrá-lo inline** (mínimo: nome + CNPJ vindos do
   XML) reusando [`useAddSupplier`](src/hooks/useSuppliers.ts). O `supplier_id`
   resultante é passado como `p_supplier_id` (substituindo o `null` fixo atual).
6. A criação/seleção de fornecedor deve **deduplicar por CNPJ normalizado**
   (`replace(/\D/g,'')`): se já existir fornecedor com o mesmo CNPJ, **selecioná-lo**
   em vez de criar duplicado.
7. No mesmo modo, quando a **unidade canônica da NF** for **diferente** da **unidade
   canônica de estoque** escolhida, exibir os campos **Unidade de compra** (default =
   unidade crua da NF) e **Fator de conversão**, e passá-los como
   `p_purchase_unit`/`p_conversion_rate`. Quando forem iguais, **não** exibir esses
   campos e gravar `purchase_unit = unit` com `conversion_rate = 1` (invariante do
   projeto). `conversion_rate = 0` é inválido e deve ser bloqueado.
8. O produto novo deve ser gravado com **`sku = product_code`** (código da NF) para
   que a **próxima** NF do mesmo item bata automaticamente no match por SKU (nível 1)
   sem cair em PENDENTE.
9. Ao concluir com sucesso, o item da NF deve ficar `added_to_stock=true` +
   `product_id` preenchido (sai de **PENDENTE** → **LANÇADO**) e um `stock_movements`
   `movement_type='in'` deve ter sido gravado com a **quantidade convertida** para a
   unidade de estoque.
10. **Não regredir** o modo **"Vincular existente"** (soma ao estoque de produto já
    cadastrado) nem os fluxos de "produto similar" / "SKU duplicado" já existentes no
    dialog.
11. **Consistência:** o caminho em lote ("Lançar Todos" em
    [Suppliers.tsx](src/pages/Suppliers.tsx#L112)) e o auto-import
    ([XmlImportDialog.tsx](src/components/suppliers/XmlImportDialog.tsx)) não podem
    produzir produto novo em estado pior que o modo `create` (idealmente passam a
    reutilizar a RPC corrigida / gravar cor+fornecedor+conversão quando disponíveis;
    no mínimo, não podem quebrar).

## Data model / Domain
Tabelas relevantes (schema real verificado em `ssvxfoybzmjlypnipqzn`):

- **`products`** — `id, name, sku, category, color, unit, location, group_id,
  quantity, unit_price, min_stock, max_stock, purchase_unit, conversion_rate,
  supplier_id, active` (⚠ **não existe** `description`). FK `group_id → product_groups`.
- **`suppliers`** — `id, name (NOT NULL), trade_name, cnpj (nullable, SEM unique),
  ie, contact_name, phone, email, address, city, state, zip_code, ...`. Sem
  constraint unique em `cnpj` hoje.
- **`invoices`** — `id, supplier_id (uuid FK), invoice_number, invoice_series,
  invoice_key, issue_date, total_value, xml_data, status, ...`. Toda NF **exige**
  `supplier_id` (resolvido no import: match por CNPJ ou auto-criação).
- **`invoice_items`** — `product_code, product_name, unit, quantity, unit_price,
  product_id (nullable), added_to_stock (bool)`. Item PENDENTE = `added_to_stock=false`.
- **`stock_movements`** — recebe a entrada (`movement_type='in'`); **tem** coluna
  `description` (é aqui que o "reason" faz sentido, não em `products`).

**RPC `create_product_with_initial_stock` (definição viva a corrigir):** hoje faz
`INSERT INTO products(name, sku, category, unit, location, quantity, unit_price,
min_stock, max_stock, group_id, description, supplier_id, active)`. Assinatura atual:
`(p_name, p_sku, p_category, p_unit, p_location, p_quantity, p_unit_price,
p_min_stock, p_max_stock, p_group_id, p_description, p_supplier_id, p_reason)`.
Único chamador no front: [AddToStockDialog.tsx:247](src/components/suppliers/AddToStockDialog.tsx#L247).

**Nova assinatura proposta** (parâmetros novos ao final, todos com default):
`..., p_color text DEFAULT NULL, p_purchase_unit text DEFAULT NULL, p_conversion_rate
numeric DEFAULT NULL`. `p_description` deixa de ser inserido em `products` (pode ser
usado como reason do `stock_movements`, ou removido — decisão do builder, desde que o
único chamador seja atualizado junto).

**Migration:** aplicar via Supabase MCP; usar timestamp **posterior ao arquivo mais
novo existente** (`20260922120000`) — ex.: `20260923120000` — **não** a data de hoje
(o `schema_migrations` rastreado está em `20260829120000`, mas os arquivos vão até
2026-09; usar data de hoje quebra o pipeline `db push`).

## User flows

### Happy path (item novo, unidade da NF = unidade de estoque)
1. Financeiro → Notas Fiscais → Entradas → **Importar XML**. Item não bate → toast
   azul, item **PENDENTE**.
2. Clica **"Lançar no Estoque"** → dialog abre em **"Criar novo produto"**,
   pré-preenchido (Nome, SKU=código NF, Categoria, Unidade, Grupo sugerido).
3. Operador informa **Cor** (opcional) e confirma o **Fornecedor** (já vem o da NF).
4. Clica **"Lançar no Estoque"** → RPC cria o produto (com cor + supplier_id),
   registra `stock_movements` in, marca o item `added_to_stock=true` + `product_id`.
5. Item sai de PENDENTE. Toast de sucesso.
6. **Próxima NF** do mesmo item (mesmo `cProd`) → bate por SKU automaticamente, sem
   PENDENTE.

### Alternate — unidade da NF ≠ unidade de estoque (item em embalagem)
- No passo 3, ao escolher unidade de estoque diferente da unidade da NF, aparecem
  **Unidade de compra** (default = unidade da NF) e **Fator de conversão**. Operador
  informa (ex.: 1 CX = 12 un). A entrada em estoque usa a quantidade **convertida**.

### Alternate — fornecedor da NF não cadastrado
- No passo 3, o Fornecedor default não existe na lista → operador usa **"Cadastrar"**
  inline (nome + CNPJ vindos do XML). Se já houver fornecedor com o mesmo CNPJ, o
  sistema seleciona o existente em vez de duplicar.

## Edge cases & failure modes
- **Unidade NF = unidade estoque** → não pedir conversão; gravar
  `purchase_unit=unit`, `conversion_rate=1`.
- **Fator de conversão = 0 ou vazio quando exigido** → bloquear submit com mensagem
  (invariante: `conversion_rate=0` é sempre inválido).
- **Fornecedor da NF sem CNPJ** → permite cadastrar por nome; dedup por CNPJ é
  pulado (não há chave). Não bloquear.
- **SKU duplicado** (já existe produto com esse SKU) → manter o fluxo atual de
  "unificar SKU" / usar existente ([handleUnifySku](src/components/suppliers/AddToStockDialog.tsx#L348)).
- **Produto similar por nome+cor** → manter o aviso atual ("Mesmo material e cor
  encontrado") ([handleUseSimilar](src/components/suppliers/AddToStockDialog.tsx#L291)).
- **Cor vazia** → permitido; produto nasce sem cor (aceitável quando o item não tem
  variação de cor). Não bloquear.
- **Múltiplos itens pendentes na mesma NF** → o dialog é item-a-item
  (`currentIdx`/`pendingItems`); cada item cria/li­ga o seu produto. Todos devem sair
  de PENDENTE ao final.
- **Grupo de Material vazio** → manter comportamento atual (sugerido, não
  obrigatório; aviso âmbar). O trigger de setor/categoria só cascateia se houver
  grupo.
- **Permissão** → RPC exige `is_approved_user()`; usuário não aprovado recebe erro
  claro (não a mensagem de coluna).

## Constraints & assumptions
- **Stack/convenções:** Bun; typecheck **`bunx tsc -p tsconfig.app.json --noEmit`**
  (a raiz não checa nada); ícones **@phosphor-icons/react** (não lucide);
  notificações **sonner**; **design tokens** (sem cores hardcoded — rodar
  `npm run check:tokens`); domínio em pt-BR.
- **Campos numéricos:** usar **`NumberInput`** para Fator de conversão / quantidade
  (nunca `<Input type="number">` com coerção `|| 0`, que trava no zero); valor
  monetário usa **`CurrencyInput`**. Rótulo com a **unidade ao lado** do campo de
  medida.
- **Unidades canônicas:** normalizar via `toCanonical` / helpers de
  [nfUnitConversion.ts](src/lib/nfUnitConversion.ts) e
  [materialConsumption.ts](src/lib/materialConsumption.ts); comparação NF×estoque é
  por unidade **canônica**. Invariante `purchase_unit==unit ⇒ conversion_rate=1`;
  `conversion_rate` **nunca** carrega a conversão dm²→metro (isso mora na largura da
  ficha de componente).
- **Migration:** aplicar via **Supabase MCP** com timestamp **> `20260922120000`**;
  preservar SECURITY DEFINER + `search_path=public` + `is_approved_user()` + GRANTs
  (o único chamador front é o `AddToStockDialog`, mas há migrations de segurança que
  referenciam a assinatura — por isso `DROP+CREATE+GRANT`).
- **Não tocar** em `src/integrations/supabase/types.ts` à mão (gerado); regenerar se
  necessário.
- **Assunções (defaults escolhidos onde o usuário deixou em aberto):**
  - Manter confirmação manual (sem auto-criação silenciosa no import).
  - Dedup de fornecedor **em código** por CNPJ normalizado (sem novo índice UNIQUE
    agora).
  - Grupo de Material continua opcional (aviso, não bloqueio).
  - `p_description` deixa de alimentar `products`; se aproveitado, vira reason do
    `stock_movements`.

## Open questions
- Criar índice **UNIQUE parcial** em `suppliers` por CNPJ normalizado (depois de
  limpar duplicatas existentes)? Fora do escopo agora — decidir em iteração futura.
- O caminho em lote ("Lançar Todos") deve passar a **reutilizar a RPC** corrigida
  (com cor/fornecedor/conversão) ou apenas manter o INSERT cru sem regressão? Default
  do spec: no mínimo não regredir; idealmente unificar na RPC.

## Definition of Done
Checklist verificável por terceiro:

- [ ] **R1/R3** — Query no banco confirma a nova definição de
  `create_product_with_initial_stock` **sem** `description` no `INSERT INTO products`,
  com `SECURITY DEFINER`, `search_path=public`, `is_approved_user()` e GRANTs
  preservados; **não** existe overload duplicado da função.
- [ ] **R1** — Importar uma NF com item novo → "Lançar no Estoque" → "Criar novo
  produto" → **Lançar**: cria sem o erro *column "description"...*; produto aparece em
  Estoque.
- [ ] **R2/R4** — O produto criado tem `color` preenchido (quando informado) — conferir
  em Estoque / `select color from products where sku = <código NF>`.
- [ ] **R5/R6** — O produto criado tem `supplier_id` = fornecedor da NF; cadastrar
  fornecedor inexistente pelo dialog cria **um** fornecedor (sem duplicar quando o
  CNPJ já existe).
- [ ] **R7** — Para item com unidade NF ≠ estoque, os campos Unidade de compra + Fator
  aparecem; ao lançar, `products.purchase_unit`/`conversion_rate` gravados e a
  quantidade em estoque está **convertida**. Para unidade igual, campos não aparecem e
  `conversion_rate=1`.
- [ ] **R8/R9** — Após lançar, o item sai de **PENDENTE** (`added_to_stock=true`,
  `product_id` setado) e há um `stock_movements` `in` com a quantidade convertida.
- [ ] **R8** — **Reimportar** uma segunda NF com o mesmo `cProd` → o item **bate
  automaticamente** por SKU (não vai pra PENDENTE).
- [ ] **R10** — "Vincular existente", "produto similar" e "SKU duplicado" continuam
  funcionando (regressão manual rápida).
- [ ] **R11** — "Lançar Todos" (lote) e o auto-import continuam funcionando e não
  criam produto em estado pior que o modo `create`.
- [ ] **Build** — `bunx tsc -p tsconfig.app.json --noEmit` limpo e
  `npm run check:tokens` sem violações novas.
