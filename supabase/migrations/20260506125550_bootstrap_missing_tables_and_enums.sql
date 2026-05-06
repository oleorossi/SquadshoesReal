-- Bootstrap: enums e tabelas que faltavam nas migrations originais
-- Aplicado via MCP em 2026-05-06 12:55:50 UTC

DO $$ BEGIN
  CREATE TYPE public.insole_mode_enum AS ENUM ('cortar', 'pronta_na_cor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pessoa_tipo AS ENUM ('FISICA', 'JURIDICA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stage_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tarifa_tipo AS ENUM ('POR_KG', 'POR_M3', 'FIXO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public."baus" (
  "active" boolean,
  "altura_cm" numeric NOT NULL,
  "capacidade_kg" numeric,
  "comprimento_cm" numeric NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "largura_cm" numeric NOT NULL,
  "nome" text NOT NULL,
  "notas" text,
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."box_types" (
  "active" boolean,
  "altura_cm" numeric NOT NULL,
  "comprimento_cm" numeric NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  "empilhamento_maximo" numeric,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "interno" boolean,
  "largura_cm" numeric NOT NULL,
  "min_stock" numeric NOT NULL,
  "nome" text NOT NULL,
  "peso_kg" numeric,
  "quantity" numeric NOT NULL,
  "supplier_id" uuid,
  "unit_price" numeric NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."item_types" (
  "active" boolean,
  "altura_cm" numeric,
  "comprimento_cm" numeric,
  "created_at" timestamptz DEFAULT now(),
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "largura_cm" numeric,
  "nome" text NOT NULL,
  "peso_kg" numeric,
  "updated_at" timestamptz DEFAULT now(),
  "volume_cm3" numeric
);

CREATE TABLE IF NOT EXISTS public."transport_companies" (
  "active" boolean,
  "condicoes_pagamento" text,
  "created_at" timestamptz DEFAULT now(),
  "documento" text,
  "email" text,
  "endereco" jsonb,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome" text NOT NULL,
  "observacoes" text,
  "seguro" boolean,
  "servicos" text[],
  "sla_dias" numeric,
  "telefone" text,
  "tipo_pessoa" public.pessoa_tipo,
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."transport_company_rates" (
  "created_at" timestamptz DEFAULT now(),
  "estado" text NOT NULL,
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "minimo" numeric,
  "moeda" text,
  "tipo_valor" public.tarifa_tipo,
  "transport_company_id" uuid NOT NULL,
  "updated_at" timestamptz DEFAULT now(),
  "valor_capital" numeric,
  "valor_interior" numeric,
  "vigencia_fim" text,
  "vigencia_inicio" text
);
