# Squad Shoes — Industrial Editorial Pro

ERP de fábrica de calçado feminino (Brasil). Telas operacionais: o dono abre um Pedido de Venda e precisa **ver muitos dados ao mesmo tempo** (cliente, grade, tiras, totais) sem perder o alvo de digitação.

## Visual language (hard constraints)

- Fonts ONLY: Anton (display, uppercase), Fira Sans (body), Fira Code (mono). Never Inter, Playfair, Geist, serif display.
- Colors ONLY from tokens: PAPER `#FAFAF7`, INK `#0A0A0A`, Squad red `#D9264E` (`hsl(347 71% 50%)`). Red is identity AND destructive — pair red with size/weight, never as the only signal.
- Surfaces: `bg-background` / `bg-card`, borders `border-border` or `border-foreground/15` at 1.5px. Controls `rounded-sm`. No `bg-white`, `text-gray-*`, `rounded-xl` marketing cards, no colored gradients.
- Semantic status greens/ambers/reds (`bg-emerald-500/10 text-emerald-700`, `bg-amber-500/10`, `bg-red-500/10`) are allowed.
- Density: base 13px. Table data 12px. Eyebrow 10px uppercase tracking. Buttons: outline 1.5px. Default control `h-9`; dense `h-8` minimum for typing. Do not go below 28px hit target.
- Motion: fade only on dialogs. No zoom/slide. `active:scale-[0.97]` on buttons.

## PV flow screens

1. **Lista `/sales`** — Editorial header compact + SalesOperationsRail + filter bar + table of PVs.
2. **Ficha do PV** (dialog, `?pv=`) — sticky identity + 3 action groups (Pedido / Materiais / Documentos) + commercial dl + grouped refs with color rows and grade mini-table.
3. **Editar/Novo** — commercial cards + item cards (photo, ref, material, color, price, grade NumberInputs, straps).
4. **Consumo** — summary strip + sole map + sticky decision rail.
5. **Pendências** — severity list with icon+label (never color-only).

## Density direction (~85% of current editorial zoom)

Keep the same system. Shrink hero type and empty padding so grade/tiras appear above the fold. Compact header sticky. Commercial data as a 5–6 column strip. Item photos `h-10`. Decision strip 1–4 folds into the item header. Inputs stay `h-8+`.
