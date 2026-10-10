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
