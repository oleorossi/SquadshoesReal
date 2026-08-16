# Identidade comercial de variantes e tiras compradas prontas

> Decisão normativa de 16/08/2026. Este documento complementa
> `variacao-material-pv.md`, `variante-material-por-grupo.md` e
> `tiras-artesanais-unificacao.md`. Em conflito, esta decisão posterior prevalece.

## Objetivo

Permitir que uma única referência tenha alternativas de material, como NAPA SOFT e
NAPA MADRI, com SKU comercial próprio, preservando a ficha/consumo; registrar também o
código da cor usado pelo fornecedor no produto físico exato; e representar tiras
compradas prontas, como STRASS, sem classificá-las nem tratá-las como fabricação
artesanal.

## Decisões de domínio

- A referência identifica a construção, molde, grade, operações, BOM e geometria de
  consumo.
- A variante de material identifica uma oferta comercial da mesma referência e possui
  SKU próprio. Trocar SOFT por MADRI não duplica a ficha quando construção e consumo em
  dm²/par permanecem iguais.
- A cor do fornecedor é propriedade do produto físico exato de matéria-prima
  (`grupo + cor + fornecedor`), não da referência nem da variante, pois a mesma NAPA
  MADRI OFF WHITE é reutilizada em várias referências.
- Tira artesanal é uma capacidade de produção, não a categoria de todas as tiras.
  STRASS é uma tira comprada pronta, com identidade independente da napa do calçado.

## Requisitos

### A. Variante comercial e SKU

1. `reference_material_variants.sku` identifica a variante comercial da referência e é
   obrigatório em variante ativa.
2. SKUs não vazios de variantes são únicos por comparação normalizada, sem diferença de
   caixa ou espaços nas extremidades. Duplicidade existente bloqueia a migration e gera
   diagnóstico; nenhum SKU histórico é renomeado automaticamente.
3. Nome da variante continua único por referência e a área/consumo permanece integralmente
   herdada da ficha.
4. O item do PV congela snapshot comercial da variante: ID, nome, SKU, GTIN quando houver,
   NCM, descrição, cor, preço contratual e proveniência.
5. Alterar ou inativar a variante depois do PV não muda nem bloqueia NF, devolução ou
   etiqueta do item já confirmado. `sale_order_items.unit_price` é o preço contratual; o
   `unit_price_override` vivo serve somente como sugestão durante a edição.
6. Cores oferecidas para novos itens são derivadas dos produtos ativos do grupo efetivo da
   variante. `available_colors` permanece apenas como legado/auditoria e não vence o grupo.
7. Uma linha de `sheet_materials` específica só pode apontar variante pertencente à mesma
   ficha. Relação cruzada preexistente bloqueia a constraint para revisão, sem remapeamento
   inferido.
8. O rótulo de `insole_material_group_id` deve refletir a semântica viva de placa/EVA. A
   forração da palmilha não será reinterpretada nesse campo.

### B. Código de cor do fornecedor

9. `products.supplier_color_code` guarda o código daquela cor no catálogo do fornecedor
   indicado em `products.supplier_id`. Não substitui `products.color`, `products.sku` nem o
   SKU da variante comercial.
10. Valor vazio é normalizado para `NULL`; valor não nulo exige `supplier_id`.
11. O código não tem unicidade global: fornecedores e famílias diferentes podem reutilizar
    a mesma sequência.
12. O campo aparece nos editores individuais de produto. Criação/edição em lote nunca copia
    um único código para todas as cores, e propagação entre produtos irmãos não o inclui.
13. Trocar o fornecedor limpa o código antigo na mesma edição, salvo se o usuário informar
    explicitamente um novo código.
14. A resolução é estrutural:

    ```text
    variante material + cor do PV
      -> grupo efetivo
      -> produto ativo exato do grupo + cor
      -> supplier_id + supplier_color_code
    ```

    Nenhum lookup pode escolher apenas pelo texto da cor.

### C. Tira comprada pronta

15. Variante de tira passa a declarar:
    - `identity_basis='reference_base'|'finished_product_group'`;
    - `internal_production_enabled boolean`.
16. `reference_base` preserva o comportamento de tiras cortadas de SOFT/MADRI. Em
    `finished_product_group`, a identidade vem do grupo próprio do componente acabado e não
    muda quando a napa da referência muda.
17. `finished_product_group` implica `internal_production_enabled=false`,
    `purchase_enabled=true`, reposição do piso `buy_ready`, produto acabado no mesmo grupo e
    cadastro comercial válido. Receita interna é proibida.
18. A linha técnica persiste `identity_basis` e `identity_group_id`. Para
    `finished_product_group`, o grupo é obrigatório; para legado ausente, o default é
    `reference_base`.
19. No PV, uma tira sem produção interna tem origem fixa **Comprar pronta**. O servidor
    rejeita `internal`, e a demanda `buy_ready` mantém receita, produto-base e rendimento
    nulos. Nunca cria lote, OS de transformação nem reserva/baixa de napa.
20. Produtos de tira comprada pronta permanecem `products.is_artisanal=false` e aparecem na
    UI como **Comprada pronta**. O domínio e o hub usam o nome geral **Tiras**, preservando a
    rota `/tiras-artesanais` por compatibilidade.
21. O backfill de STRASS usa somente os IDs explícitos dos grupos 6 mm e 15 mm já registrados
    em migration. Não há inferência por nome. Cadastro comercial incompleto ou vínculo
    ambíguo fica em revisão; histórico terminal não é reescrito.

## Fora de escopo

- Criar SKU diferente para cada combinação variante material + cor. O SKU desta decisão é
  da variante de material; a cor permanece dimensão separada do item do PV.
- Unificar agora os GTINs legados de `reference_color_variants` com o GTIN da variante de
  material. O snapshot preserva o valor usado sem declarar um novo dono global.
- Suportar múltiplos fornecedores simultâneos por produto. Quando isso for necessário, deve
  existir catálogo `produto + fornecedor`; não serão duplicadas colunas na variante.
- Inventar código de fornecedor, SKU, cor canônica, receita ou vínculo de STRASS durante o
  backfill.

## Definition of Done

- [ ] SOFT e MADRI na mesma referência salvam SKUs distintos e não alteram o consumo em
      dm²/par da ficha.
- [ ] SKU duplicado normalizado é rejeitado pelo servidor e pela UI.
- [ ] Alterar nome/SKU/NCM/preço ou inativar a variante depois da confirmação não altera nem
      bloqueia NF/etiqueta do PV existente.
- [ ] BOM específico de outra referência é rejeitado.
- [ ] `available_colors` manual não oferece cor sem produto ativo no grupo efetivo.
- [ ] NAPA MADRI OFF WHITE salva um código de fornecedor reutilizado por duas referências;
      NAPA SOFT OFF WHITE pode salvar código diferente.
- [ ] Produto sem fornecedor rejeita código de cor; lote de cores não replica o código.
- [ ] STRASS resolve a mesma variante/produto em referências SOFT e MADRI, aceita somente
      `buy_ready` e nunca cria produção/reserva de napa.
- [ ] Tira artesanal `reference_base` continua separando SOFT de MADRI e conserva os fluxos
      internos/híbridos existentes.
- [ ] Typecheck, testes focados, suíte completa, tokens e build passam.
