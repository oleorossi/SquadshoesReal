#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN não configurado}"
: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID não configurado}"

migration_root="${1:-supabase/migrations}"
max_attempts="${SUPABASE_MIGRATION_WAIT_ATTEMPTS:-90}"
wait_seconds="${SUPABASE_MIGRATION_WAIT_SECONDS:-10}"
cutoff_version="${SUPABASE_MIGRATION_CUTOFF:-20270101009300}"
sp124_migration="${migration_root}/20270101014800_sp124_composite_upper_guards.sql"
sp124_postdeploy_key="20270101014800_sp124_composite_upper_guards"
requires_sp124_postdeploy=false
if [[ -f "$sp124_migration" ]]; then
  requires_sp124_postdeploy=true
fi

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]] || [[ ! "$wait_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "Tentativas e intervalo do gate de migrations devem ser inteiros positivos." >&2
  exit 1
fi
if [[ ! "$cutoff_version" =~ ^[0-9]{14}$ ]]; then
  echo "Cutoff de migrations inválido: ${cutoff_version}" >&2
  exit 1
fi

wait_tmp_dir=$(mktemp -d)
cleanup_wait_tmp() {
  rm -rf -- "$wait_tmp_dir"
}
trap cleanup_wait_tmp EXIT

find "$migration_root" -maxdepth 1 -type f -name '[0-9]*_*.sql' \
  -exec basename {} \; \
  | sed -nE 's/^([0-9]{14})_.*/\1/p' \
  | sort -u > "$wait_tmp_dir/all_local_versions.txt"

while IFS= read -r version; do
  if [[ "$version" > "$cutoff_version" ]]; then
    printf '%s\n' "$version"
  fi
done < "$wait_tmp_dir/all_local_versions.txt" > "$wait_tmp_dir/required_versions.txt"

required_version=$(tail -n 1 "$wait_tmp_dir/required_versions.txt")
if [[ ! "$required_version" =~ ^[0-9]{14}$ ]]; then
  echo "Não foi possível determinar as migrations pós-cutover exigidas pelo commit." >&2
  exit 1
fi
required_count=$(wc -l < "$wait_tmp_dir/required_versions.txt" | tr -d ' ')

query="SELECT version::text AS version FROM supabase_migrations.schema_migrations WHERE version::text > '${cutoff_version}' ORDER BY version"
jq -nc --arg query "$query" '{query: $query}' > "$wait_tmp_dir/query.json"
marker_query="SELECT EXISTS (SELECT 1 FROM public.deployment_postdeploy_checks WHERE check_key = '${sp124_postdeploy_key}') AS verified"
jq -nc --arg query "$marker_query" '{query: $query}' > "$wait_tmp_dir/marker-query.json"

for attempt in $(seq 1 "$max_attempts"); do
  if ! code=$(curl -sS \
    --connect-timeout 10 \
    --max-time 30 \
    -o "$wait_tmp_dir/response.json" \
    -w '%{http_code}' \
    -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data @"$wait_tmp_dir/query.json"); then
    echo "Falha de rede ao consultar migrations (tentativa $attempt/$max_attempts)."
    sleep "$wait_seconds"
    continue
  fi
  if [[ "$code" -ge 200 && "$code" -lt 300 ]]; then
    jq -r \
      'if type == "array" then .[] | (.version // empty) else empty end' \
      "$wait_tmp_dir/response.json" \
      | sed -nE '/^[0-9]{14}$/p' \
      | sort -u > "$wait_tmp_dir/remote_versions.txt"
    comm -23 \
      "$wait_tmp_dir/required_versions.txt" \
      "$wait_tmp_dir/remote_versions.txt" > "$wait_tmp_dir/missing_versions.txt"

    remote_version=$(tail -n 1 "$wait_tmp_dir/remote_versions.txt")
    missing_count=$(wc -l < "$wait_tmp_dir/missing_versions.txt" | tr -d ' ')
    echo "Migration remota máxima=${remote_version:-ausente}; exigida=${required_version}; pendentes=${missing_count}/${required_count}"
    if [[ ! -s "$wait_tmp_dir/missing_versions.txt" ]]; then
      if [[ "$requires_sp124_postdeploy" != "true" ]]; then
        echo "✓ Banco contém todas as migrations pós-cutover exigidas pelo commit"
        exit 0
      fi

      if marker_code=$(curl -sS \
        --connect-timeout 10 \
        --max-time 30 \
        -o "$wait_tmp_dir/marker-response.json" \
        -w '%{http_code}' \
        -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        --data @"$wait_tmp_dir/marker-query.json"); then
        if [[ "$marker_code" -ge 200 && "$marker_code" -lt 300 ]] \
          && [[ "$(jq -r 'if type == "array" then (.[0].verified // false) else false end' "$wait_tmp_dir/marker-response.json")" == "true" ]]; then
          echo "✓ Banco contém as migrations e o contrato pós-deploy SP124 exigidos pelo commit"
          exit 0
        fi
        echo "Contrato pós-deploy SP124 ainda pendente (HTTP $marker_code; tentativa $attempt/$max_attempts)."
      else
        echo "Falha de rede ao consultar contrato pós-deploy SP124 (tentativa $attempt/$max_attempts)."
      fi
    fi
  else
    echo "Consulta de migration retornou HTTP $code (tentativa $attempt/$max_attempts)."
  fi
  sleep "$wait_seconds"
done

echo "Banco não contém todas as migrations e contratos pós-deploy exigidos até ${required_version}; deploy bloqueado." >&2
if [[ -s "$wait_tmp_dir/missing_versions.txt" ]]; then
  echo "Versões ausentes:" >&2
  sed 's/^/  - /' "$wait_tmp_dir/missing_versions.txt" >&2
fi
exit 1
