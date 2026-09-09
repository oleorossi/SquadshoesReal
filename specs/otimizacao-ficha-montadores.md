# Otimização da Ficha de Montadores

> Correção de escopo (08/09/2026): quem lança a produção **não é o profissional**.
> É o administrativo (ou encarregado) que preenche os pares de cada montador/
> solador. O profissional de chão **não** tem — e neste ciclo **não ganha** —
> login para lançar a própria produção.

## Goal

Melhorar a Ficha administrativa (`/fichas-montadores`) para quem lança pela
equipe e fecha o pagamento semanal:

1. UX da bancada (menos cliques, digitação rápida, mobile, régua clara)
2. Jornada unificada Lançar → Conferir/pagar → Relatórios
3. Relatórios do período com export CSV e comparativo vs semana anterior
4. Pagamento semanal permanece na mesma tela (módulo `ficha_pagamento`)

## Escopo

### In
- Bancada mais rápida: `+5 fichas`, placeholder `7f`, régua sticky, Copiar de ontem
- CTA **Salvar e conferir** (Dia/Semana + dock sticky)
- Trilha de jornada + badge de rascunho ao mudar de etapa
- Semana no celular: um dia por vez (sem grade horizontal)
- Trava de rascunho ao mudar período em Conferir
- Export CSV do período (pessoa × dia × pares × valor)
- Comparativo com a semana anterior no resumo
- Loading explícito na bancada de lançamento

### Out (explícito)
- Self-service do montador (`/minha-producao`, papel `montador`, `employees.user_id`)
- PIN/kiosk no chão
- Pagamento pelo próprio profissional
- Reescrever o monólito da Ficha

## Done when

- Administrativo lança com menos fricção (régua sticky, atalhos, mobile Semana)
- Após salvar, um clique leva a Conferir/pagar na mesma semana
- Administrativo exporta o período em CSV
- No modo semana, o resumo mostra delta vs semana anterior
- Bancada mostra loading enquanto carrega
- Typecheck + testes verdes
