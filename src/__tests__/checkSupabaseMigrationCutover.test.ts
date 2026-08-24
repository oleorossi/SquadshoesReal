import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertBaseline,
  hashVersions,
  inspectMigrationDirectory,
} from '../../scripts/check-supabase-migration-cutover.mjs';

const temporaryDirectories = [];

function migrationDirectory(files) {
  const directory = mkdtempSync(join(tmpdir(), 'migration-cutover-'));
  temporaryDirectories.push(directory);
  for (const file of files) {
    writeFileSync(join(directory, file), '-- fixture\n');
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('check-supabase-migration-cutover', () => {
  it('gera SHA256 determinístico da lista ordenada sem newline final', () => {
    expect(hashVersions(['20270101000200', '20270101000100'])).toBe(
      '12f6f5a72082ddbe0d8a6feb86e8f59d08f1f22610456e519468aa9f46861697',
    );
  });

  it('recusa timestamps duplicados e informa todos os arquivos envolvidos', () => {
    const directory = migrationDirectory([
      '20270101000100_primeira.sql',
      '20270101000100_segunda.sql',
    ]);

    expect(() => inspectMigrationDirectory(directory)).toThrow(
      '20270101000100: 20270101000100_primeira.sql, 20270101000100_segunda.sql',
    );
  });

  it('recusa arquivo SQL fora do padrão canônico de 14 dígitos', () => {
    const directory = migrationDirectory(['20270101_invalida.sql']);

    expect(() => inspectMigrationDirectory(directory)).toThrow(
      'Arquivos de migration com nome inválido',
    );
  });

  it('congela somente versões até o corte e aceita migrations futuras', () => {
    const versions = ['20270101000100', '20270101000200'];
    const directory = migrationDirectory([
      '20270101000100_primeira.sql',
      '20270101000200_segunda.sql',
      '20270101009400_futura.sql',
    ]);
    const inventory = inspectMigrationDirectory(directory);

    expect(assertBaseline(inventory, {
      count: versions.length,
      sha256: hashVersions(versions),
    }, 'fixture')).toMatchObject({
      totalCount: 3,
      legacyCount: 2,
      postCutoverCount: 1,
    });
  });

  it('recusa divergência de quantidade antes de comparar o hash', () => {
    const directory = migrationDirectory(['20270101000100_primeira.sql']);
    const inventory = inspectMigrationDirectory(directory);

    expect(() => assertBaseline(inventory, {
      count: 2,
      sha256: inventory.legacySha256,
    }, 'fixture')).toThrow('quantidade legada divergente; esperado 2, encontrado 1');
  });

  it('recusa troca silenciosa de versão com a mesma quantidade', () => {
    const directory = migrationDirectory(['20270101000100_primeira.sql']);
    const inventory = inspectMigrationDirectory(directory);

    expect(() => assertBaseline(inventory, {
      count: 1,
      sha256: hashVersions(['20270101000200']),
    }, 'fixture')).toThrow('SHA256 legado divergente');
  });
});
