-- ════════════════════════════════════════════════════════════════════════
-- Busca padronizada system-wide — estende search_norm às tabelas que faltavam
-- (spec: specs/melhorias-busca-sistema.md, R6/R7)
--
-- A migration 20260613120000 criou normalize_search() + search_norm em 6
-- tabelas (products, clients, sale_orders, technical_sheets, suppliers,
-- economic_groups). Esta estende o mesmo padrão às tabelas usadas pelas
-- buscas de tela grandes/crescentes e pelas novas seções da busca global
-- (⌘K): OPs, OCs, OSs, NF-e, movimentações, financeiro, auditoria,
-- funcionários, grupos de estoque e terceirizados.
--
-- Cobertura de campos = regra "visível + identificadores" da spec: tudo que a
-- linha da lista mostra + identificadores que o usuário tem em mãos (número,
-- CNPJ/CPF, telefone, chave de NF-e). CNPJ/telefone entram porque
-- normalize_search preserva dígitos ("12.345.678/0001-90" → "12345678000190",
-- então buscar só os dígitos casa).
--
-- ⚠ Coluna GENERATED rejeita INSERT/UPDATE que inclua search_norm no payload —
-- os caminhos client-side que passam objetos opacos foram auditados e fazem
-- strip defensivo (ver spec, edge case "clone via spread").
--
-- Volumes na aplicação (2026-07-11): audit_logs 1397, service_orders 356,
-- stock_movements 325, orders 241, financial_entries 153 — todas pequenas,
-- STORED é instantâneo; sem índice trigram (pg_trgm nem está instalado;
-- adiar até alguma busca medir > ~500ms — ver Constraints da spec).
-- ════════════════════════════════════════════════════════════════════════

-- OPs — lista de ordens + ⌘K (nº, cor, status)
alter table public.orders add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(order_number,'') || ' ' || coalesce(color,'') || ' ' || coalesce(status,'')
  )) stored;

-- OCs — nº, fornecedor (denormalizado na row), status, notas
alter table public.purchase_orders add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(order_number,'') || ' ' || coalesce(supplier_name,'') || ' ' ||
    coalesce(status,'') || ' ' || coalesce(notes,'')
  )) stored;

-- OSs — nº, descrição, material, setor, status. Nome do prestador é FK
-- (contractors) — o app resolve em 2 passos: contractors.search_norm → ids →
-- service_orders.contractor_id IN (...).
alter table public.service_orders add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(order_number,'') || ' ' || coalesce(description,'') || ' ' ||
    coalesce(material_name,'') || ' ' || coalesce(material_color,'') || ' ' ||
    coalesce(sector,'') || ' ' || coalesce(target_sector,'') || ' ' ||
    coalesce(status,'') || ' ' || coalesce(artisanal_output_name,'')
  )) stored;

-- NF-e — nº, série, chave de acesso, destinatário (nome + CNPJ), status
alter table public.nfe_emitidas add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(numero,'') || ' ' || coalesce(serie,'') || ' ' ||
    coalesce(chave_acesso,'') || ' ' || coalesce(nome_destinatario,'') || ' ' ||
    coalesce(cnpj_destinatario,'') || ' ' || coalesce(status,'') || ' ' ||
    coalesce(ref_nfe,'')
  )) stored;

-- Movimentações de estoque — descrição, tipo, motivo, usuário. Nome do produto
-- é FK — o app resolve via products.search_norm → ids → product_id IN (...).
alter table public.stock_movements add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(description,'') || ' ' || coalesce(movement_type,'') || ' ' ||
    coalesce(movement_reason,'') || ' ' || coalesce(user_email,'')
  )) stored;

-- Financeiro — descrição, categoria, tipo, status, sku, coleção, notas
alter table public.financial_entries add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(description,'') || ' ' || coalesce(category,'') || ' ' ||
    coalesce(type,'') || ' ' || coalesce(status,'') || ' ' ||
    coalesce(sku,'') || ' ' || coalesce(collection,'') || ' ' || coalesce(notes,'')
  )) stored;

-- Auditoria — ação, recurso, id do recurso, erro, IP, usuário e payload
-- (new_data::text entra pra preservar a busca "nos dados" que a tela de
-- Auditoria fazia client-side; volume é pequeno, STORED é barato).
alter table public.audit_logs add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(action,'') || ' ' || coalesce(resource,'') || ' ' ||
    coalesce(resource_id,'') || ' ' || coalesce(error_message,'') || ' ' ||
    coalesce(ip_address,'') || ' ' || coalesce(user_id::text,'') || ' ' ||
    coalesce(new_data::text,'')
  )) stored;

-- Funcionários — nome, cargo, setor, CPF, telefones
alter table public.employees add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(name,'') || ' ' || coalesce(role,'') || ' ' ||
    coalesce(department,'') || ' ' || coalesce(cpf,'') || ' ' ||
    coalesce(phone,'') || ' ' || coalesce(whatsapp,'')
  )) stored;

-- Grupos de estoque — nome, descrição, cores, setor
alter table public.product_groups add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
    coalesce(colors,'') || ' ' || coalesce(sector,'')
  )) stored;

-- Terceirizados — nome, fantasia, CNPJ/CPF, cidade, tipo de serviço
-- (usado pelo ⌘K pra achar OS pelo nome do prestador)
alter table public.contractors add column if not exists search_norm text
  generated always as (public.normalize_search(
    coalesce(name,'') || ' ' || coalesce(trade_name,'') || ' ' ||
    coalesce(cnpj_cpf,'') || ' ' || coalesce(city,'') || ' ' ||
    coalesce(service_type,'')
  )) stored;
