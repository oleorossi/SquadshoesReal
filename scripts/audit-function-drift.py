#!/usr/bin/env python3
"""
Guard de DRIFT: o corpo VIVO das funcoes do banco bate com o que as migrations
declaram?

Motivacao (auditoria 01/08/2026): 204 das 501 funcoes de `public` tinham corpo em
producao que NENHUMA das 1.327 migrations reproduzia, e 23 tinham uma migration
declarando uma definicao que nunca surtiu efeito. Nada no projeto detectava isso
— a auditoria de 30/07 conferia EXISTENCIA de objeto, nao o CORPO.

USO
---
1) Produza o dump das funcoes vivas como JSON [{"proname":..., "prosrc":...}]:

   psql "$DATABASE_URL" -Atc \
     "select json_agg(row_to_json(t)) from (
        select p.proname, p.prosrc
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
      ) t" > live_functions.json

   (Sem psql, o mesmo SELECT via Supabase MCP/SQL Editor serve.)

2) Rode o guard:

   python3 scripts/audit-function-drift.py live_functions.json

Saida: relatorio por categoria. Exit 1 se houver categoria B (migration escrita
que nunca surtiu efeito) — esse e o caso que sempre indica erro humano.
As categorias C e D sao reportadas mas nao falham por padrao, porque hoje sao a
linha de base historica; use --strict para falhar nelas tambem.

CATEGORIAS
----------
A  ultima migration que define o nome bate com alguma assinatura viva  -> ok
B  o banco bate com uma migration ANTERIOR, nao com a ultima
   -> a ultima migration NUNCA surtiu efeito
C  nenhuma migration reproduz o corpo vivo
   -> patch aplicado fora do versionamento (MCP / SQL Editor)
D  nome vivo sem nenhuma migration que o defina
"""
import argparse
import hashlib
import json
import os
import re
import sys

DECL = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?\"?([A-Za-z_][A-Za-z_0-9]*)\"?\s*\(",
    re.I,
)
ASTAG = re.compile(r"\bAS\s+(\$[A-Za-z_0-9]*\$)", re.I)


def md5(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def scan_migrations(migdir):
    """nome -> [defs em ordem de versao], corpo equivalente a pg_proc.prosrc."""
    out = {}
    for order, fname in enumerate(sorted(f for f in os.listdir(migdir) if f.endswith(".sql"))):
        try:
            src = open(os.path.join(migdir, fname), encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for m in DECL.finditer(src):
            tag = ASTAG.search(src, m.end())
            if not tag:
                continue
            # outra declaracao antes do AS => esta nao tem corpo dollar-quoted
            nxt = DECL.search(src, m.end())
            if nxt and nxt.start() < tag.start():
                continue
            end = src.find(tag.group(1), tag.end())
            if end == -1:
                continue
            out.setdefault(m.group(1), []).append(
                {"file": fname, "md5": md5(src[tag.end():end]), "order": order}
            )
    for v in out.values():
        v.sort(key=lambda x: x["order"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("live_json", help='JSON [{"proname","prosrc"}] do banco vivo')
    ap.add_argument("--migrations", default="supabase/migrations")
    ap.add_argument("--strict", action="store_true", help="falha tambem em C e D")
    args = ap.parse_args()

    raw = json.load(open(args.live_json, encoding="utf-8"))
    if isinstance(raw, dict):  # tolera {"rows": [...]}
        raw = next(v for v in raw.values() if isinstance(v, list))

    live = {}
    for r in raw:
        live.setdefault(r["proname"], set()).add(md5(r["prosrc"]))

    mig = scan_migrations(args.migrations)
    cat = {"A": [], "B": [], "C": [], "D": []}

    for name, hashes in sorted(live.items()):
        defs = mig.get(name)
        if not defs:
            cat["D"].append((name, None, None))
        elif defs[-1]["md5"] in hashes:
            cat["A"].append((name, defs[-1]["file"], None))
        else:
            hit = [d for d in defs if d["md5"] in hashes]
            if hit:
                cat["B"].append((name, hit[-1]["file"], defs[-1]["file"]))
            else:
                cat["C"].append((name, defs[-1]["file"], None))

    total = sum(len(v) for v in cat.values())
    print(f"funcoes vivas: {total}   migrations varridas: {args.migrations}")
    for k, label in [
        ("A", "ultima migration == banco"),
        ("B", "ultima migration NUNCA surtiu efeito"),
        ("C", "nenhuma migration reproduz o corpo vivo"),
        ("D", "sem migration que a defina"),
    ]:
        pct = (100.0 * len(cat[k]) / total) if total else 0
        print(f"  {k}  {len(cat[k]):4d}  ({pct:4.1f}%)  {label}")

    if cat["B"]:
        print("\nB — migration escrita que nao esta no ar:")
        for name, got, last in sorted(cat["B"], key=lambda x: x[2]):
            print(f"  {name}\n      banco roda : {got}\n      declarada em: {last}")

    if args.strict and cat["C"]:
        print("\nC — corpo vivo sem arquivo correspondente:")
        for name, last, _ in cat["C"]:
            print(f"  {name}  (ultima migration que o cita: {last})")

    failed = bool(cat["B"]) or (args.strict and (cat["C"] or cat["D"]))
    if failed:
        print("\nFALHOU: ha divergencia entre o banco vivo e as migrations.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
