#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CUTOVER_VERSION = '20270101009300';

// Lista de versões locais após resolver a colisão 09100 -> 09150. O hash usa
// somente as versões ordenadas, separadas por "\n" e sem newline final.
export const LOCAL_LEGACY_BASELINE = Object.freeze({
  count: 1480,
  sha256: '2733d2a64fecaadb239ed5ad17b8bd2046c1eb2106fb485c7b65aca1f08b0460',
});

// Histórico vivo de produção, incluindo os três reparos do worker de Tiras
// aplicados em 24/08/2026 e o reparo de prontidão de palmilha aplicado em
// 28/08/2026 (20260828111941). Marcadores temporários podem ter qualquer nome
// descritivo: o contrato do Supabase compara os timestamps.
export const REMOTE_LEGACY_BASELINE = Object.freeze({
  count: 2291,
  sha256: 'b97f401f3bdb0e52b2efad8b69c3af3e404bcd89ef709036375732465df78b84',
});

const MIGRATION_FILE = /^(\d{14})_(.+)\.sql$/;

export function hashVersions(versions) {
  return createHash('sha256')
    .update([...versions].sort().join('\n'))
    .digest('hex');
}

export function inspectMigrationDirectory(directory, cutoff = CUTOVER_VERSION) {
  const absoluteDirectory = resolve(directory);
  const sqlFiles = readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const invalidFiles = sqlFiles.filter((file) => !MIGRATION_FILE.test(file));
  if (invalidFiles.length > 0) {
    throw new Error(
      `Arquivos de migration com nome inválido em ${absoluteDirectory}: ${invalidFiles.join(', ')}`,
    );
  }

  const migrations = sqlFiles.map((file) => ({
    file,
    version: file.match(MIGRATION_FILE)[1],
  }));
  const filesByVersion = new Map();

  for (const migration of migrations) {
    const files = filesByVersion.get(migration.version) ?? [];
    files.push(migration.file);
    filesByVersion.set(migration.version, files);
  }

  const duplicates = [...filesByVersion.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files }))
    .sort((a, b) => a.version.localeCompare(b.version));

  if (duplicates.length > 0) {
    const details = duplicates
      .map(({ version, files }) => `${version}: ${files.join(', ')}`)
      .join('; ');
    throw new Error(`Timestamps de migration duplicados: ${details}`);
  }

  const legacyVersions = migrations
    .map(({ version }) => version)
    .filter((version) => version <= cutoff)
    .sort();

  return {
    directory: absoluteDirectory,
    totalCount: migrations.length,
    legacyCount: legacyVersions.length,
    legacySha256: hashVersions(legacyVersions),
    postCutoverCount: migrations.length - legacyVersions.length,
  };
}

export function assertBaseline(inventory, expected, label) {
  if (inventory.legacyCount !== expected.count) {
    throw new Error(
      `${label}: quantidade legada divergente; esperado ${expected.count}, encontrado ${inventory.legacyCount}`,
    );
  }

  if (inventory.legacySha256 !== expected.sha256) {
    throw new Error(
      `${label}: SHA256 legado divergente; esperado ${expected.sha256}, encontrado ${inventory.legacySha256}`,
    );
  }

  return inventory;
}

export function validateLocalDirectory(directory) {
  return assertBaseline(
    inspectMigrationDirectory(directory),
    LOCAL_LEGACY_BASELINE,
    'Histórico local',
  );
}

export function validateRemoteDirectory(directory) {
  return assertBaseline(
    inspectMigrationDirectory(directory),
    REMOTE_LEGACY_BASELINE,
    'Histórico remoto temporário',
  );
}

function usage() {
  return [
    'Uso:',
    '  bun scripts/check-supabase-migration-cutover.mjs local [diretório]',
    '  bun scripts/check-supabase-migration-cutover.mjs remote <diretório>',
  ].join('\n');
}

export function run(argv = process.argv.slice(2)) {
  const [mode, directoryArgument, ...extra] = argv;
  if (extra.length > 0 || !['local', 'remote'].includes(mode)) {
    throw new Error(usage());
  }

  if (mode === 'remote' && !directoryArgument) {
    throw new Error(`O modo remote exige um diretório.\n${usage()}`);
  }

  const directory = directoryArgument ?? 'supabase/migrations';
  const inventory = mode === 'local'
    ? validateLocalDirectory(directory)
    : validateRemoteDirectory(directory);

  console.log(
    `✓ ${mode}: ${inventory.legacyCount} versões legadas <= ${CUTOVER_VERSION}; `
      + `SHA256 ${inventory.legacySha256}; ${inventory.postCutoverCount} pós-corte.`,
  );
  return inventory;
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
