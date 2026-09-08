# Otimização da Ficha de Montadores

> Decisão do dono (08/09/2026): os quatro eixos (UX, relatórios, pagamento,
> acesso do funcionário) atrapalham o uso diário. Quem lança hoje é só o
> administrativo — o montador/solador **não tem acesso**.

## Goal

1. O próprio funcionário (regime por par) lança a produção do dia e consulta
   os próprios pares (dia / semana / mês) sem ver a grade da equipe nem pagar.
2. O administrativo continua com a grade completa, pagamento semanal e
   relatórios — com export CSV e comparação com a semana anterior.
3. Sem reabrir perda de corte, sem vincular a OP/PV, sem regime híbrido.

## Escopo

### In
- Vínculo `employees.user_id` → `auth.users`
- Papel `montador` + rota `/minha-producao` (módulo `ficha_montadores_self`)
- RLS: montador só vê/escreve a própria linha; gestores mantêm o acesso total
- Tela própria mobile-first (lançar + resumo próprio)
- Export CSV do período na Ficha administrativa
- Comparativo com a semana anterior no resumo
- Skeleton de loading na Ficha administrativa
- Vincular conta no cadastro do funcionário + criar usuário com papel Montador

### Out
- PIN/kiosk sem login
- Pagamento pelo próprio montador
- Comparar mês a mês com meta
- Reescrever o monólito de 2.5k linhas da Ficha administrativa

## Done when

- Conta vinculada ao funcionário por-par abre `/minha-producao` e só grava
  `montador_id` = ele
- Conta sem vínculo vê mensagem clara pedindo o RH
- Admin/RH ainda fecha a semana e paga pela Ficha
- CSV do período exporta pessoa × dia × pares × valor
- Typecheck + testes de acesso/contrato verdes
