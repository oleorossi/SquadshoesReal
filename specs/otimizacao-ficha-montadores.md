# Otimização da Ficha de Montadores

> Correção de escopo (08/09/2026): quem lança a produção **não é o profissional**.
> É o administrativo (ou encarregado) que preenche os pares de cada montador/
> solador. O profissional de chão **não** tem — e neste ciclo **não ganha** —
> login para lançar a própria produção.

## Goal

Melhorar a Ficha administrativa (`/fichas-montadores`) para quem lança pela
equipe e fecha o pagamento semanal:

1. UX da bancada (loading, clareza)
2. Relatórios do período com export CSV e comparativo vs semana anterior
3. Pagamento semanal permanece na mesma tela (módulo `ficha_pagamento`)

## Escopo

### In
- Export CSV do período (pessoa × dia × pares × valor)
- Comparativo com a semana anterior no resumo
- Loading explícito na bancada de lançamento

### Out (explícito)
- Self-service do montador (`/minha-producao`, papel `montador`, `employees.user_id`)
- PIN/kiosk no chão
- Pagamento pelo próprio profissional
- Reescrever o monólito da Ficha

## Done when

- Administrativo exporta o período em CSV
- No modo semana, o resumo mostra delta vs semana anterior
- Bancada mostra loading enquanto carrega
- Typecheck + testes verdes
