# Fichas de Operador — canvas de decisão

Arquivos-fonte do canvas publicado em
<https://claude.ai/code/artifact/d7229e4d-5aa5-4003-8c1c-7d431313b20f>.

**Rodada 1 (esta):** escolher a INFORMAÇÃO de cada ficha. As três opções de cada
setor usam de propósito o mesmo estilo de hoje (Anton / Fira Sans / Fira Code,
preto puro + `#C00000`) — o que varia é o conteúdo, não o visual.
**Rodada 2:** estética, depois que o conteúdo estiver fechado.

## Os três modelos

| | Princípio | Serve a |
|---|---|---|
| **A · A mão** | só o que a mão executa | o operador |
| **B · O lote** | identidade do lote físico, sem repetição | o chão de fábrica + rastreio |
| **C · O turno** | a ficha volta preenchida e vira dado | PCP / custeio |

## Artboards

`Main` (guia) + `<Setor><A\|B\|C>` para Montagem, Palmilha (Corte de Placa de
Fibra), Silk, Solagem e Expedição. `canvas.json` posiciona tudo em 6 páginas.

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
