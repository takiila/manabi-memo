import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Load the real TSX components, rather than duplicating their event handlers.

export function resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      for (const extension of ['.ts', '.tsx']) {
        const url = new URL(specifier + extension, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(specifier, context);
}
export function load(url, context, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
}
