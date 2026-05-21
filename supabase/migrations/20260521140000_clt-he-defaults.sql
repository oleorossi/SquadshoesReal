-- Marker do migration aplicada via MCP (clt_defaults_he_multipliers).
-- =============================================================================
-- CLT: defaults corretos pros multiplicadores de HE (art. 7º XVI)
-- =============================================================================
-- ALTER TABLE employees: overtime_50_pct default 50, overtime_100_pct default 100
-- UPDATE backfill: zerados → 50/100
SELECT 1;
