# Atualização do Dashboard — biz-stock-zen
> Apenas 2 arquivos mudam. O resto do sistema fica intacto.

---

## Arquivos para substituir

| Arquivo no repo | Substituir por |
|---|---|
| `src/components/dashboard/KpiCard.tsx` | `KpiCard.tsx` (nesta pasta) |
| `src/components/dashboard/DashboardGrid.tsx` | `DashboardGrid.tsx` (nesta pasta) |

**Nenhum outro arquivo muda.** Props, hooks, rotas e lógica de dados são idênticos.

---

## O que muda visualmente

### KpiCard
- **Borda colorida no topo** (2px) sinaliza status imediatamente
- **Número grande em font-mono** — leitura rápida sem esforço
- Ícone menor, alinhado à direita, sem animação exagerada
- Subtítulo mais discreto

### DashboardGrid
- `gap` ajustado de `gap-3` → `gap-2.5` (mais coeso)
- `space-y-6` → `space-y-3` (menos separação entre linhas)
- **Saldo Líquido** virou `FinHighlightCard` — fundo escuro (#0D0D0D), valor em lime (#C8FF00)
- Subtítulo "Prazo OK" no card de OPs em Atraso quando está zerado

---

## Como aplicar

### Opção A — Lovable (mais fácil)
1. Abra o projeto no Lovable
2. Navegue até `src/components/dashboard/`
3. Clique em `KpiCard.tsx` → substitua o conteúdo
4. Clique em `DashboardGrid.tsx` → substitua o conteúdo
5. Salve — o Lovable faz o deploy automático

### Opção B — Git direto
```bash
# Na raiz do biz-stock-zen:
cp KpiCard.tsx src/components/dashboard/KpiCard.tsx
cp DashboardGrid.tsx src/components/dashboard/DashboardGrid.tsx
git add src/components/dashboard/
git commit -m "feat(dashboard): improved KPI card hierarchy and financial highlight"
git push
```

---

## Compatibilidade

- ✅ Mesmas props — nenhum componente pai precisa mudar
- ✅ Usa shadcn/ui (`cn` do `@/lib/utils`)
- ✅ Tailwind puro — sem dependências novas
- ✅ Dark mode compatível (usa variáveis `bg-card`, `text-foreground`, `text-muted-foreground`)
