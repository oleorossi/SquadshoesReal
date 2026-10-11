# Consumo por par na ficha técnica (aba Identificação)

> Decidido com o dono em 10/10/2026 (entrevista antes de construir).

## Objetivo
Na ficha técnica (`/fichas-tecnicas` → aba **Identificação** → card **Dados Principais**),
mostrar o **consumo total por par** de cada tipo de tira e de cada material, sem precisar
abrir a aba Materiais & Consumo.

## Requisitos
1. **Somente leitura.** A edição continua só na aba **Materiais & Consumo**. O bloco tem um
   link/atalho para essa aba. Não criar segunda porta de edição.
2. **Agrupado por material** (produto/grupo de estoque). O mesmo material usado em dois
   componentes vira **uma** linha somada.
   - **Tiras:** agrupar por tipo/medida do catálogo (ex.: `TIRA CHATA 8MM`).
3. **Valor = média por par**, mais um controle "ver por numeração" que expande a tabela
   numeração × consumo.
   - A média só considera as numerações da **grade da ficha**, não todo valor cadastrado.
   - Para cada numeração vale o valor por numeração quando existe; senão, o escalar.
     Usar `pickConsumptionForSize`.
4. **Unidade = unidade de estoque do produto**, seguindo a regra canônica do CLAUDE.md:
   - **Material de área de bobina:** dm²/par ÷ (`dimensions_width` da ficha de
     componente ÷ 10) = **m/par**.
   - **Unidade de placa:** dm² ÷ área da placa.
   - **Sem largura:** mostrar em dm² com o aviso âmbar `widthMissing`.
   - **Tiras:** salvas em **cm/par** em `strap_colors` (o input mostra cm/pé, ÷2). Exibir em
     **m/par** (cm ÷ 100). Nunca usar o valor por pé.
   - **Item linear direto/contagem:** unidade nativa, sem conversão.
   - **Sem perda de corte** (regra do dono, 03/08/2026).
5. **Escopo: tudo que tem consumo, exceto:**
   - **Forração:** forro do cabedal **e** forro da palmilha (setor `Forração da Palmilha`
     e os campos de forro).
   - **Fibra:** qualquer material cujo grupo de estoque tenha `FIBRA` no nome.
   - **Químicos:** setor `Cola / Químico`.
   - **Entra:** cabedal, fachete, palmilha (sem ser fibra), acessórios/materiais extras
     (`components_accessories`), linhas do BOM (`sheet_materials`), tiras e solado
     (1 par/par).
6. Ficha **sem nenhum consumo** cadastrado: o bloco mostra um estado vazio com o link para
   Materiais & Consumo.

## Fontes de dados (já carregadas no editor `src/pages/TechnicalSheets.tsx`)
- `form` (`upper_*`, `fachete_*`, `components_accessories`, `strap_colors`, grade)
- `sheetMaterials` (`useSheetMaterials`)
- `componentSheets` (largura)
- `strapCatalog`
- Specs do solado (palmilha por numeração)

Não criar query nova se o dado já está no editor.

## Implementação
- A lógica pura vai em `src/lib/sheetPerPairConsumption.ts`, com testes colocados.
- O componente fica em `src/components/technical-sheets/`. A página só o importa.

## Pronto quando
- O bloco aparece em "Dados Principais".
- Os testes da lib cobrem:
  - média restrita à grade
  - conversão dm²→m
  - fallback dm² sem largura
  - tira cm→m sem ÷2
  - exclusões (forro, FIBRA, químico)
  - soma do mesmo material
- `bunx tsc -p tsconfig.app.json --noEmit`, `bun run test` e `bun run check:tokens` passam
  limpos.
- Verificado no site de produção (regra 7).

---

# Revisão 2 — só exclusivos + custo por par, no topo da aba

> Decidido com o dono em 11/10/2026 (entrevista `/grill-me` com prévia aprovada).

## Mudanças
1. **Posição:** o bloco sai de dentro de "Dados Principais" e vira **card próprio no topo
   da aba Identificação**, título **"Consumo e custo por par"** ("Consumo por par" para
   quem não vê custo).
2. **Só o que é exclusivo do modelo.** Saem também os itens básicos: **solado, palmilha,
   cola (COLA FORTE / COLA PVC), linha (LINHANYL) e embalagem** — além de forração, fibra
   e químicos, que já saíam. Ficam cabedal, tiras, componentes diretos (fivela…),
   materiais extras e as demais linhas do BOM.
   - ⚠ Cola, linha e embalagem estão cadastradas como setor `Componente` em 14–18 fichas,
     então o filtro por setor deixava passar. A exclusão passa a casar também por
     **palavra inteira** no nome (`COLA`, `LINHA…`, `EMBALAGE…`) — nunca substring solta
     (`CHOCOLATE` contém `COLA`).
3. **Custo em todas as linhas:** consumo · preço unitário · **custo/par** = consumo médio
   × preço. Rodapé **"Total exclusivo do modelo"** com a lista do que ficou de fora.
4. **Preço = `products.unit_price`** (custo unitário de estoque) — mesma fonte do custeio
   do PV (`calculate_order_cost_item`), sem o snapshot congelado (a ficha usa o preço
   atual). A ficha não tem cor, então:
   - **mediana** do custo das cores com preço > 0, na mesma unidade da linha;
   - quando as cores divergem, mostra a **faixa por par** ("R$ 1,00–1,25 conforme a cor").
5. **Quais SKUs contam ("cores") por linha:**
   - cabedal / material extra / BOM: SKUs ativos do **grupo** do material;
   - componente direto: o próprio SKU; sem preço → grupo dele (estimado);
   - tira **comprada pronta** (`finished_product_group`): SKUs do grupo da identidade;
   - tira **feita da napa** (`reference_base`): SKUs acabados das variantes do Hub
     (`artisanal_strap_variants`) da medida × napa-base do modelo (`referenceStrapBaseGroups`,
     já descascada de MASSABOX); `fixed_group`/`select_on_order` usam o(s) grupo(s) da linha.
6. **Sem preço na napa do modelo → "estimado":** mediana de **todas** as cores dos grupos
   acabados daquela medida, marcada "estimado pelo grupo — sem preço na <napa>". Sem faixa
   (o grupo inteiro mistura bases e outliers). Nada com preço → **"sem preço"** e o total
   avisa "+N sem preço".
7. **Linha em dm² sem largura:** sem custo (preço é por unidade de estoque) e conta no
   "+N sem preço".
8. **Quem vê R$:** mesma regra do Hub de Tiras — `capabilities.can_see_financial_values`
   (`can_see_strap_financial_values()`: quem tem só `producao`/`almoxarifado` não vê).
   Sem a capacidade (ou catálogo não carregado): só consumo, sem preço, custo e total.
9. **"Ver por numeração":** continua consumo por numeração; entra só a coluna **R$/par**
   (custo médio) no fim.
10. **O papel vem do campo da ficha, não do setor de estoque** (achado do dono na SP301).
    NAPA SOFT / NAPA SUDANI / GLOW METALIC são estocadas como `Forração da Palmilha` e usadas
    como cabedal em 9 fichas ativas (CF 05, I110, LA01, SP105, SP119, SP132, SP301, ST702,
    ST703, STX): o filtro por setor sumia com o cabedal — já na revisão 1. Para Cabedal,
    Material extra e Tiras o setor não exclui (o nome ainda exclui); na BOM o setor manda.
11. **Unidade do grupo = unidade da maioria das cores**, preferindo m/placa para material de
    área — nunca o primeiro SKU da lista (vem por `updated_at`; um débito na única cor em `un`
    trocava a unidade do cabedal).
12. **Grupo de estoque misto** (`COMPONENTES DIVERSOS`, `Tira chata 8mm` com ELÁSTICO dentro):
    a mediana só usa SKUs do mesmo material (`materialIdentity`) ou, em tira, com o prefixo
    tipo+medida no nome. Grupo da tira comprada pronta vale inteiro (os nomes ali são só a cor).

## Pendências de cadastro observadas (NÃO resolvidas aqui — dado do dono)
- `TIRA OVERLOCK 5MM` COBRE com `unit_price` R$ 20,50/m (demais 23 cores a R$ 0,85). A
  mediana blinda o card; o custeio de PV em COBRE usa o número cru.
- Os 9 SKUs de overlock 5 mm feitos da NAPA SOFT estão com custo R$ 0.

## Pronto quando (revisão 2)
- Testes da lib cobrem: exclusão dos básicos por setor e por palavra inteira (sem pegar
  CHOCOLATE), mediana/faixa, unidade divergente, estimado pelo grupo, sem preço, sem
  largura, total + contagem de pendentes.
- `bunx tsc -p tsconfig.app.json --noEmit`, `bun run test`, `bun run lint` (arquivos
  tocados) e `bun run check:tokens` limpos.
- Verificado no site de produção na ficha I703 (regra 7).
