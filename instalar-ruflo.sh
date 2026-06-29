#!/usr/bin/env bash
#
# instalar-ruflo.sh
# Instala o Ruflo (meta-harness de agentes pro Claude Code) numa pasta de teste
# isolada, pra você ver o que ele gera ANTES de mexer no projeto da Squad Shoes.
#
# Como usar: deixe esse arquivo numa pasta qualquer e rode:
#   bash instalar-ruflo.sh
#
set -e

echo "==> 1. Verificando Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado. Instale antes de continuar (https://nodejs.org)."
  exit 1
fi
echo "   Node $(node -v) ok."

echo "==> 2. Criando pasta de teste isolada (~/ruflo-teste)..."
mkdir -p ~/ruflo-teste
cd ~/ruflo-teste

echo "==> 3. Rodando o assistente de init do Ruflo..."
echo "   (vai criar .claude/, .claude-flow/, CLAUDE.md e afins AQUI, não no ERP)"
npx ruflo@latest init wizard

echo ""
echo "==> 4. (opcional) Registrar o Ruflo como servidor MCP no Claude Code:"
echo "   claude mcp add ruflo -- npx ruflo@latest mcp start"
echo ""
echo "✅ Pronto. Tudo foi criado em ~/ruflo-teste — explore os arquivos antes de"
echo "   decidir usar no projeto de produção."
