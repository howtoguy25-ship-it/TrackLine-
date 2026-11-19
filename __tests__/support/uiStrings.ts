// Every piece of text a file can put on screen: string literals, template text and JSX text.
// Comments aren't included. Used by the wording tests (no "--", no route names).
import { readFileSync } from "fs";
import ts from "typescript";

export interface UiString {
  file: string;
  line: number;
  text: string;
}

export function uiStrings(file: string): UiString[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: UiString[] = [];
  const add = (node: ts.Node, text: string) => {
    if (!text.trim()) return;
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    // Skip import paths and type-only positions.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) add(span.literal, span.literal.text);
    } else if (ts.isJsxText(node)) add(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
