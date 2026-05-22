-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ sector_grouping_config — política de agrupamento por setor          │
-- ├─────────────────────────────────────────────────────────────────────┤
-- │ Antes desta migration, a política estava hardcoded em               │
-- │ PrintWorkSheetsPage.tsx via constantes SOLE_COLOR_GROUPED_SECTORS   │
-- │ e REF_COLOR_GROUPED_SECTORS. Mudar a regra exigia mudança de        │
-- │ código + deploy.                                                    │
-- │                                                                     │
-- │ Esta tabela exterioriza a config — admin pode alterar via SQL ou    │
-- │ futura UI sem redeploy. Defaults batem com o comportamento atual    │
-- │ (zero breaking change ao rodar a migration).                        │
-- │                                                                     │
-- │ Strategies suportadas:                                              │
-- │   - 'sole_color': agrupa por (solado, cor cabedal)                  │
-- │   - 'ref_color':  agrupa por (ref, cor) — modelos NÃO se fundem    │
-- │   - 'sole_only':  agrupa só por solado (ex: Corte Palmilha)         │
-- │   - 'color_only': agrupa só por cor (ex: Solagem por cor solado)    │
-- │   - 'client':     agrupa por cliente/CNPJ (Expedição)               │
-- │   - 'none':       sem consolidação — 1 ficha por OP                 │
-- └─────────────────────────────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS sector_grouping_config (
  sector text PRIMARY KEY,
  strategy text NOT NULL CHECK (strategy IN (
    'sole_color', 'ref_color', 'sole_only', 'color_only', 'client', 'none'
  )),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sector_grouping_config IS
  'Política de agrupamento de fichas por setor. Lida pelo frontend em PrintWorkSheetsPage.tsx pra decidir a chave de consolidação.';

-- Defaults: replicam SOLE_COLOR_GROUPED_SECTORS + REF_COLOR_GROUPED_SECTORS
-- + as escolhas que estavam hardcoded em cada useMemo.
INSERT INTO sector_grouping_config (sector, strategy, notes) VALUES
  ('Corte Palmilha', 'sole_only',  'Cortador foca no molde do solado; cor irrelevante.'),
  ('Corte Forração', 'sole_color', 'Forro cortado por cor — refs com mesmo solado+cor compartilham 1 ficha.'),
  ('Corte Cabedal',  'sole_color', 'Couro cortado por cor; agrupa refs com mesmo material/cor.'),
  ('Silk',           'ref_color',  'Arte do silk é específica do modelo — refs NÃO se fundem.'),
  ('Costura',        'sole_color', 'Linha por cor; mesmo molde de costura entre refs com mesmo solado.'),
  ('Aviamento',      'sole_color', 'Componentes (fivelas/tiras) por cor; refs com mesmo solado+cor juntas.'),
  ('Montagem',       'ref_color',  'Molde do casco específico do modelo; refs NÃO se fundem.'),
  ('Colagem',        'ref_color',  'Cola entre cabedal específico + solado; preserva ref.'),
  ('Solagem',        'color_only', 'Cola do solado por cor; ignora cabedal/ref.'),
  ('Acabamento',     'ref_color',  'Embalagem individual por modelo + cor (legacy: 1 ficha por OP).'),
  ('Expedição',      'client',     'Romaneio por cliente/CNPJ (LOJA-A-LOJA).')
ON CONFLICT (sector) DO NOTHING;

-- RLS: read-only pra qualquer authenticated user; writes apenas admin via
-- service_role (frontend NÃO escreve nessa tabela — só lê).
ALTER TABLE sector_grouping_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone authenticated reads sector_grouping_config" ON sector_grouping_config;
CREATE POLICY "anyone authenticated reads sector_grouping_config"
  ON sector_grouping_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Trigger pra atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION sector_grouping_config_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_sector_grouping_config_updated_at ON sector_grouping_config;
CREATE TRIGGER tg_sector_grouping_config_updated_at
  BEFORE UPDATE ON sector_grouping_config
  FOR EACH ROW
  EXECUTE FUNCTION sector_grouping_config_set_updated_at();
