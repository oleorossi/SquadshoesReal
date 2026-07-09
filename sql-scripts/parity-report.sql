-- Relatório de paridade SQL↔TS (somente leitura).
-- Uso: workflow supabase-db-exec.yml (strict=true) ou SQL Editor / MCP.
SELECT case_name, ok, message FROM public.run_consumption_parity_tests() ORDER BY case_name;
