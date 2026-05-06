# Dashboard Executivo — Squad Shoes
> Estrutura pronta para colar no **Lovable**

---

## Stack
- React + TypeScript
- Tailwind CSS
- Recharts (gráficos)
- lucide-react (ícones)

---

## Dependências necessárias

No Lovable, solicite as instalações ou adicione ao `package.json`:

```bash
npm install recharts lucide-react
```

Fontes (adicione no `index.html` ou `globals.css`):
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:ital,wght@0,400;0,700&display=swap" rel="stylesheet" />
```

No `tailwind.config.js`, adicione as fontes:
```js
theme: {
  extend: {
    fontFamily: {
      sans: ["Space Grotesk", "sans-serif"],
      mono: ["Space Mono", "monospace"],
    },
  },
},
```

---

## Estrutura de arquivos

```
src/
├── pages/
│   └── Dashboard.tsx          ← página principal (cole aqui a rota)
└── components/
    └── dashboard/
        ├── Sidebar.tsx         ← nav lateral dark
        ├── TopBar.tsx          ← barra superior
        ├── KPICard.tsx         ← cards de KPI com status colorido
        ├── FinCard.tsx         ← cards financeiros
        ├── ChartsRow.tsx       ← área + donut (Recharts)
        └── BottomRow.tsx       ← tabela de modelos + lista de OPs
```

---

## Como usar no Lovable

1. **Crie um novo projeto** no Lovable
2. Instale as dependências acima via prompt ou package.json
3. Copie cada arquivo para o caminho indicado
4. Adicione a rota `/` apontando para `Dashboard.tsx`
5. Adicione as fontes no `index.html`

---

## Tokens de cor (Squad Shoes)

| Token            | Valor     | Uso                        |
|------------------|-----------|----------------------------|
| `#0D0D0D`        | near-black | fundo sidebar, textos, FAB |
| `#C8FF00`        | lime       | acento ativo na sidebar     |
| `#F5F5F5`        | gray-50    | fundo geral                 |
| `#EF4444`        | red-500    | estoque crítico, atraso     |
| `#F59E0B`        | amber-500  | alertas, vencidos           |
| `#22C55E`        | green-500  | OPs OK, produção ativa      |
| `#3B82F6`        | blue-500   | OEE, produção (gráfico)     |

---

## Personalização rápida

- **Dados reais**: substitua os arrays em `ChartsRow.tsx` e `BottomRow.tsx` por chamadas à sua API
- **Novos KPIs**: adicione `<KPICard>` no grid de 6 colunas em `Dashboard.tsx`
- **Novas seções na sidebar**: edite o array `navGroups` em `Sidebar.tsx`
