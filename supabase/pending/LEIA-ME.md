# Migrações Pendentes — Aplicar no Supabase Dashboard

SQL Editor: https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new

## Ordem de aplicação (OBRIGATÓRIA — do mais antigo para o mais novo)

| Arquivo | O que faz |
|---------|-----------|
| `GRUPO_A_abr19-21.sql` | Correções de solado, motor de ondas, estoque, ERP, fornecedores, tiras, horas extras, receitas artesanais |
| `GRUPO_BC_abr24-26.sql` | Consumo por numeração, fluxo de setores, embalagem, conjugações de numeração |
| `GRUPO_D_abr27.sql` | MRP reserva, PO grade, contas a pagar, ondas, funcionário HE, escala, automações, palmilha, fachete, Mesa (tiras), transição manual |
| `GRUPO_E_abr28.sql` | Upsert ponto, seda por categoria, bloqueio PVs rascunho, dedup OC-00127, artesanal stock, NF-e multi-CNPJ, inteligência de ondas |
| `GRUPO_F_abr29.sql` | Lead-time fallback, auto-start ondas, timeline material, setores Mesa/Palmilha, dias úteis, RLS, embalagem |
| `GRUPO_G_abr30-mai01.sql` | Kanban↔onda, solado qty em ondas, embalagem por solado, débito conjugado estrito |

## Como aplicar no Lovable / Supabase

1. Abra o arquivo desejado neste repositório
2. Copie todo o conteúdo SQL
3. Cole no SQL Editor do Supabase e execute
4. Aplique na ordem acima (A → BC → D → E → F → G)
5. Se um grupo falhar, corrija antes de continuar
