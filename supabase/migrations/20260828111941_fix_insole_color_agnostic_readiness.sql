-- Marcador de histórico para a aplicação imediata feita via Supabase MCP.
--
-- Nesta posição cronológica o resolver area-first ainda não existia, portanto
-- executar o patch aqui quebraria o replay de um banco novo. A mudança
-- canônica e idempotente vive em:
--   20270101013700_fix_insole_color_agnostic_readiness.sql
--
-- Manter este marcador alinha a versão gravada no banco de produção com o
-- diretório local sem antecipar a correção para antes da função alvo existir.

SELECT 1;
