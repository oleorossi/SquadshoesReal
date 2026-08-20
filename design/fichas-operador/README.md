# Fichas de Operador — canvas de decisão

Arquivos-fonte do canvas publicado em
<https://claude.ai/code/artifact/d7229e4d-5aa5-4003-8c1c-7d431313b20f>.

**Rodada 1 — decidida.** Escolhas do dono, por setor:

| Setor | Modelo | Agrupamento que a ficha tem de respeitar |
|---|---|---|
| Montagem | **B** | referência + cor |
| Corte de Placa de Fibra | **B** | **só solado** — a cor não entra no corte |
| Silk | **A** | solado + silk |
| Solagem | **B** | cor do solado, preto separado |

**Em aberto:** a Expedição, com o pedido replicado em várias lojas. Três opções
(E1 folha por loja · E2 matriz loja × item · E3 por referência), todas sobre o
mesmo pedido: 8 referências, 3 lojas, 29 caixas, 364 pares, curva de colmeia real
(`33/34 · 35 · 36 · 37 · 38 · 39/40`), extraída da onda `df7b8337`.

**Rodada 2:** estética, depois que a Expedição fechar.

## Os três modelos da rodada 1

| | Princípio | Serve a |
|---|---|---|
| **A · A mão** | só o que a mão executa | o operador |
| **B · O lote** | identidade do lote físico, sem repetição | o chão de fábrica + rastreio |
| **C · O turno** | a ficha volta preenchida e vira dado | PCP / custeio |

As opções não escolhidas foram removidas do canvas depois da decisão — ficam no
histórico do git (commits `e03d115` e `a395c80`).

## Artboards

`Main` (estado da decisão) + as quatro escolhidas (`MontagemB`, `PalmilhaB`,
`SilkA`, `SolagemB`) + as três da Expedição (`ExpedicaoE1/E2/E3`).
`canvas.json` põe tudo em **uma página só**, para o canvas mostrar as fichas de
imediato ao abrir — a versão anterior escondia as previews atrás de um menu de
páginas.

Cada A4 é 794 × 1123 px (96 dpi), com 30 px de margem — o mesmo padrão dos
componentes de print reais em `src/components/production/`.

## Regerar o canvas

```bash
node "<skill>/seed-canvas.mjs" \
  --template "<skill>/payload.template.html" \
  --out fichas-de-operador.html --title "Fichas de Operador" \
  --artboard Main.dc.html --artboard MontagemA.dc.html … \
  --canvas canvas.json
```

O `.html` gerado (~2,5 MB) **não é versionado** — a fonte são os `.dc.html` +
`canvas.json`. Editar sempre os `.dc.html` e re-semear; nunca editar o `.html`.
