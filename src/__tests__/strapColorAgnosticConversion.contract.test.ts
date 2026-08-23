import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const migration = read('supabase/migrations/20270101004800_color_agnostic_strap_conversions.sql');
const conversionEditor = read('src/components/artisanal-straps/ArtisanalStrapConversionEditor.tsx');
const stockEditor = read('src/components/artisanal-straps/ArtisanalStrapEditor.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');

describe('conversão de tiras independente de cor', () => {
  it('salva família, medida e receita atomicamente sem produto ou variante', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.save_artisanal_strap_conversion');
    expect(migration).toContain('public.save_artisanal_strap_type(');
    expect(migration).toContain('public.save_artisanal_strap_measure(');
    expect(migration).toContain('public.save_artisanal_strap_recipe(');
    expect(migration).toContain("Conversao de tira nao aceita cor, produto ou variante de estoque");
    expect(migration).not.toContain('public.save_artisanal_strap_variant(');
    expect(migration).not.toContain('INSERT INTO public.products');
  });

  it('não apresenta seletor de cor nem produto no editor de conversão', () => {
    expect(conversionEditor).toContain('Defina os números uma única vez por família, medida e napa-base');
    expect(conversionEditor).toContain('Nenhuma cor é gravada aqui');
    expect(conversionEditor).not.toContain('colorId');
    expect(conversionEditor).not.toContain('Cor canônica');
    expect(conversionEditor).not.toContain('finishedProductId');
  });

  it('mantém a cor no estoque e impede o editor de variante de regravar a receita', () => {
    expect(stockEditor).toContain('Cor canônica *');
    expect(stockEditor).toContain('recipe: undefined');
    expect(stockEditor).toContain('use a aba Receitas');
  });

  it('abre o fluxo correto em Receitas e edita a conversão sem depender de variante', () => {
    expect(hub).toContain("activeTab === 'cadastro' || activeTab === 'receitas'");
    expect(hub).toContain("purpose: 'conversion'");
    expect(hub).toContain('recipeId: recipe.id');
    expect(hub).toContain('Nova conversão');
  });
});
