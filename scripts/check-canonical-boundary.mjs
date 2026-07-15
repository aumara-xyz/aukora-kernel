import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const srcArgIndex = args.indexOf('--src');
const srcDir = srcArgIndex >= 0 ? path.resolve(args[srcArgIndex + 1] ?? '') : path.join(root, 'src');
const quiet = args.includes('--quiet');

if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`canonical Fu boundary: source directory not found: ${srcDir}`);
  process.exit(1);
}

const forbiddenModule = /(?:^|\/)(?:authority|convex|memory|aura|kira)(?:\/|$)|aumlok|nativeLiveApply|policyKernel|signer|voiceLane|opencode\/auth|symbiotePaths/i;
const networkModule = /^(?:(?:node:)?(?:http|https|http2|net|tls|dns|dgram)(?:\/|$)|undici(?:\/|$)|axios$|ws$|openai(?:\/|$)|@openai\/|openrouter(?:\/|$)|@openrouter\/)/;
const effectModule = /^(?:node:)?(?:child_process|cluster|worker_threads|module|vm)(?:\/|$)/;
const filesystemModule = /^(?:node:)?fs(?:\/promises)?$/;
const allowedFilesystemFiles = new Set(['aukoraFuSpendLedger.ts']);
const forbiddenAmbientPath = /(?:\.aukora-symbiote|opencode\/auth|symbiotePaths)/i;
const failures = [];

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (entry.isFile() && /\.(?:c|m)?tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

function moduleLiteral(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function checkModule(rel, specifier, kind) {
  if (specifier === null) {
    failures.push(`${rel}: non-literal ${kind} is forbidden`);
    return;
  }
  if (forbiddenModule.test(specifier)) failures.push(`${rel}: forbidden import ${specifier}`);
  if (networkModule.test(specifier)) failures.push(`${rel}: forbidden network module ${specifier}`);
  if (effectModule.test(specifier)) failures.push(`${rel}: forbidden effect module ${specifier}`);
  if (filesystemModule.test(specifier) && !allowedFilesystemFiles.has(rel)) {
    failures.push(`${rel}: forbidden filesystem module ${specifier}`);
  }
}

function accessPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${accessPath(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return `${accessPath(node.expression)}.${node.argumentExpression.text}`;
  }
  return '';
}

for (const file of listSourceFiles(srcDir)) {
  const rel = path.relative(srcDir, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    failures.push(`${rel}: TypeScript parse diagnostic: ${message}`);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) checkModule(rel, moduleLiteral(node.moduleSpecifier), 'import');
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      checkModule(rel, moduleLiteral(node.moduleReference.expression), 'import-equals');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        checkModule(rel, moduleLiteral(node.arguments[0]), 'dynamic import');
      } else if (accessPath(node.expression) === 'require' || accessPath(node.expression).endsWith('.require')) {
        checkModule(rel, moduleLiteral(node.arguments[0]), 'CommonJS require');
      }

      const called = accessPath(node.expression);
      if (/^(?:globalThis\.|window\.)?fetch$/.test(called)
        || /^(?:navigator\.)?sendBeacon$/.test(called)
        || /^(?:Bun|Deno)\.(?:connect|listen|serve)$/.test(called)) {
        failures.push(`${rel}: forbidden network capability ${called}`);
      }
    } else if (ts.isNewExpression(node)) {
      const constructed = accessPath(node.expression);
      if (/^(?:globalThis\.|window\.)?(?:WebSocket|EventSource|XMLHttpRequest)$/.test(constructed)) {
        failures.push(`${rel}: forbidden network capability ${constructed}`);
      }
    }

    if (ts.isIdentifier(node) && /^(?:fetch|WebSocket|EventSource|XMLHttpRequest)$/.test(node.text)) {
      failures.push(`${rel}: forbidden network capability ${node.text}`);
    }
    if (ts.isIdentifier(node) && node.text === 'process') {
      failures.push(`${rel}: forbidden ambient process capability`);
    }
    if (ts.isIdentifier(node) && /^(?:Bun|Deno)$/.test(node.text)) {
      failures.push(`${rel}: forbidden ambient runtime capability ${node.text}`);
    }
    if (ts.isIdentifier(node) && /^(?:globalThis|window|navigator)$/.test(node.text)) {
      failures.push(`${rel}: forbidden ambient global capability ${node.text}`);
    }
    if (ts.isIdentifier(node) && node.text === 'require') {
      failures.push(`${rel}: forbidden CommonJS require capability`);
    }
    if (ts.isIdentifier(node) && /^(?:module|eval|Function)$/.test(node.text)) {
      failures.push(`${rel}: forbidden dynamic-code capability ${node.text}`);
    }

    const accessed = accessPath(node);
    if (accessed === 'module.require' || accessed.endsWith('.module.require')) {
      failures.push(`${rel}: forbidden CommonJS require capability`);
    }
    if (accessed === 'process.env' || accessed.startsWith('process.env.')) {
      failures.push(`${rel}: forbidden environment capability ${accessed}`);
    }
    if (ts.isStringLiteralLike(node) && forbiddenAmbientPath.test(node.text)) {
      failures.push(`${rel}: forbidden ambient path ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (failures.length) {
  console.error([...new Set(failures)].sort().join('\n'));
  process.exit(1);
}

if (!quiet) console.log('canonical Fu boundary: clean');
