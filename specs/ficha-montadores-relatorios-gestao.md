# Ficha Montadores — Relatórios home + gestão M×S

> Decidido em grill 26/09/2026. Usuário #1 = dono (rendimento e custo de MO).

## Goal

Tornar a etapa **Relatórios** a home de `/fichas-montadores`, com visão combinada
Montagem+Solagem, comparativo de pares M×S, gestão visual “quadro de fábrica”,
chip Chamada no apontamento, e paridade tela ↔ CSV ↔ print ↔ folha.

## Escopo

### In
- Default: abre em Relatórios (`tab=producao`, `reportView=resumo`), período semana
- Home Relatórios: núcleo 1–5 (bruto · pares×taxa · caixa · ranking · calendário)
- Layout: esquerda (1–3) | direita (4) | calendário full-width (5)
- Visão combinada M+S no topo; drill-down por setor
- Comparativo M×S: Σ pares Montagem (médio+difícil) = Σ pares Solagem
  - período + breakdown diário; Δ ≠ 0 = alerta visual; não bloqueia pagar
- WoW secundário (não compete com 1–5)
- Extrair módulos Lançar / Conferir / Relatórios (mesma rota)
- Chip “Chamada hoje” no apontamento Montagem/Solagem
- Paridade com `sumProducaoRows`; CSV/print espelham filtros

### Out
- Self-service / PIN do montador
- Reformular motor de produção
- Redesign visual do print HTML
- Unificar OP + R$ numa tela
- Δ M×S no apontamento ou na bancada Lançar
- Chamada para 10 setores
- Redesign profundo da bancada Lançar

## Motor M×S

`compareMontagemSolagem(rows, from, to)` em `src/lib/fichaMontadoresMxS.ts`.
Unidade = pares totais. Solagem sem médio/difícil.

## Done when

- Home Relatórios com layout + 1–5 + faixa M×S + WoW secundário
- Módulos L/C/R extraídos; default home = Relatórios
- Chip no apontamento
- Paridade CSV/print + testes
- Verificação no site live após deploy
