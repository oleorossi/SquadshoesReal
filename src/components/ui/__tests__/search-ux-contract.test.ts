import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(process.cwd(), 'src');
const EXCLUDED_FILES = new Set([
  // Galeria visual disponível só em DEV; reproduz propositalmente variações
  // históricas de componentes para comparação lado a lado.
  path.join(ROOT, 'pages', 'DesignPreview.tsx'),
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return sourceFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function lineOf(source: ts.SourceFile, node: ts.Node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

describe('contrato de busca do sistema', () => {
  it('não permite select nativo nem campo de busca montado manualmente', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      if (EXCLUDED_FILES.has(file)) continue;
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          const tag = opening.tagName.getText(source);
          const attribute = (name: string) => opening.attributes.properties.find(
            (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText(source) === name,
          )?.getText(source) ?? '';
          const location = `${path.relative(process.cwd(), file)}:${lineOf(source, node)}`;

          if (tag === 'select') {
            violations.push(`${location} usa <select> nativo; use o Select canônico.`);
          }

          const looksLikeSearch = /(?:busc|pesquis|localiz|digitar nome)/i.test(
            `${attribute('placeholder')} ${attribute('aria-label')}`,
          ) || /(?:search|busca)/i.test(attribute('value'))
            || /set(?:Search|Busca)/.test(attribute('onChange'));
          if ((tag === 'Input' || tag === 'input') && looksLikeSearch) {
            violations.push(`${location} monta busca com <${tag}>; use SearchInput, SmartSearch ou CommandInput.`);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
