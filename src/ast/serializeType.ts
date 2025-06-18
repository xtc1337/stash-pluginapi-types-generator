import {
  ExportAssignment,
  Node,
  ObjectLiteralExpression,
  SourceFile,
  Symbol,
  ts,
  Type,
  TypeAliasDeclaration,
} from 'ts-morph';
import {
  FunctionType,
  ImportRefObjectType,
  ImportRefType,
  MappedType,
  ObjectType,
  PrimitiveType,
  SerializedType,
  UnionType,
} from './types';
import { queryTsMorphNode } from '../utils';

// --- Constants ---
const IMPORT_REF_PREFIXES = ['React.', 'ReactDOM.', 'GQL.', 'JSX.'];
const IMPORT_PREFIX_MAP: Record<string, string> = {
  gql: 'PluginApi.GQL',
  'react-bootstrap': 'PluginApi.libraries.Bootstrap',
};
const MAX_DEPTH = 10;

// --- Utility Functions ---
function isPrimitiveType(type: Type): boolean {
  return (
    type.isString() ||
    type.isNumber() ||
    type.isBoolean() ||
    type.isUndefined() ||
    type.isNull() ||
    type.isUnknown() ||
    type.isAny() ||
    (type.isLiteral() &&
      (type.isStringLiteral() ||
        type.isNumberLiteral() ||
        type.isBooleanLiteral())) ||
    ['void', 'false', 'true'].includes(type.getText().trim())
  );
}

function isClassOrAbstract(type: Type): boolean {
  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  return decl?.getKindName?.()?.includes('Class') ?? false;
}
function isStandardLibType(type: Type): boolean {
  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  const path = decl?.getSourceFile().getFilePath();

  // ⚠️ If it's an array, check its element type recursively
  if (type.isArray()) {
    const elementType = type.getArrayElementType();
    return (
      !!elementType &&
      (isPrimitiveType(elementType) || isStandardLibType(elementType))
    );
  }

  return path?.includes('/node_modules/typescript/lib/') ?? false;
}

function getImportPathForSymbol(symbol: Symbol): string | undefined {
  for (const decl of symbol.getDeclarations()) {
    if (Node.isImportSpecifier(decl)) {
      const importDecl = decl.getFirstAncestorByKind(
        ts.SyntaxKind.ImportDeclaration,
      );
      if (importDecl) return importDecl?.getModuleSpecifierValue();
    }
  }
  return undefined;
}
function getImportRefFromUnionType(
  unionType: Type,
  sourceFile: SourceFile,
): ImportRefType | ObjectType | null {
  const types = unionType.getUnionTypes();

  for (const t of types) {
    // Only process arrays
    if (!t.isArray()) continue;

    const elem = t.getArrayElementType();
    if (!elem || !elem.getText().startsWith('import("')) continue;

    const symbol = elem.getSymbol();
    if (!symbol) continue;

    const decl = symbol.getDeclarations()?.[0];
    if (!decl) continue;

    const filePath = decl.getSourceFile().getFilePath();
    const name = getBaseName(elem);

    // 🔹 Case 1: Expand if class or abstract class
    const isClass =
      Node.isClassDeclaration(decl) ||
      (Node.isClassDeclaration(decl) && decl.isAbstract?.());

    if (isClass) {
      return serializeClassType(elem, sourceFile);
    }

    // 🔹 Case 2: Non-class import (e.g. enum, type, etc.)
    return {
      kind: 'importRef',
      name,
      importPath: filePath,
    };
  }

  return null;
}

function cleanImportName(name: string): string {
  const match = name.match(/import\(".*?"\)\.(.+)/);
  return match ? match[1] : name;
}
function getBaseName(type: Type): string {
  const typeName = type.getText();
  const raw = typeName.split('<')[0].trim();
  const clean = cleanImportName(raw);

  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  const path = decl?.getSourceFile().getFilePath();

  if (path?.includes('src/core/generated-graphql')) {
    return `GQL.${clean}`;
  }

  return clean;
}

function isExternalLibraryType(type: Type): boolean {
  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  return decl?.getSourceFile().isFromExternalLibrary?.() ?? false;
}

function remapImportedLibrary(type: Type): ImportRefType | null {
  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  const declPath = decl?.getSourceFile().getFilePath();
  if (!declPath || !symbol) return null;

  for (const [pkg, prefix] of Object.entries(IMPORT_PREFIX_MAP)) {
    if (declPath.includes(`node_modules/${pkg}/`)) {
      return {
        kind: 'importRef',
        name: `${prefix}.${symbol.getName()}`,
        importPath: cleanImportPath(pkg),
      };
    }
  }
  return null;
}

// --- Specialized Serializers ---
function serializeFunctionType(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type>,
  depth: number,
): FunctionType {
  const sig = type.getCallSignatures()[0];
  const returnType = sig.getReturnType();
  const params = sig.getParameters();

  const args: Record<string, SerializedType> = {};
  const paramStrings: string[] = [];

  for (const param of params) {
    const decl = param.getDeclarations()?.[0];
    const paramType = decl
      ? param.getTypeAtLocation(decl)
      : param.getDeclaredType();

    const typeText = getBaseName(paramType);
    const paramName = param.getName();

    args[paramName] = serializeType(paramType, sourceFile, seen, depth + 1);

    paramStrings.push(`${paramName}: ${typeText}`);
  }

  const formattedSignature = `(${paramStrings.join(
    ', ',
  )}) => ${getBaseName(returnType)}`;

  return {
    kind: 'function',
    name: formattedSignature,
    args,
    returnType: serializeType(returnType, sourceFile, seen, depth + 1),
  };
}

function serializeUnionType(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type>,
  depth: number,
): SerializedType {
  const types = type.getUnionTypes();
  const fullName = types.map((t) => getBaseName(t)).join(' | ');

  const allSimple = types.every(
    (t) => isPrimitiveType(t) || isStandardLibType(t),
  );
  if (allSimple) {
    return { kind: 'primitive', name: fullName };
  }

  const fnType = types.find((t) => t.getCallSignatures().length > 0);
  const hasOnlyFnAndUndef =
    fnType && types.length === 2 && types.some((t) => isPrimitiveType(t));
  if (hasOnlyFnAndUndef && fnType) {
    return serializeType(fnType, sourceFile, seen, depth + 1);
  }

  const importRef = getImportRefFromUnionType(type, sourceFile);
  if (importRef) return importRef;

  const props: SerializedType[] = [];

  for (const t of types) {
    if (t.isArray()) {
      const elemType = t.getArrayElementType();
      if (
        elemType &&
        !(isPrimitiveType(elemType) || isStandardLibType(elemType))
      ) {
        props.push(serializeType(elemType, sourceFile, seen, depth + 1));
      }
    } else if (!(isPrimitiveType(t) || isStandardLibType(t))) {
      props.push(serializeType(t, sourceFile, seen, depth + 1));
    }
  }

  return {
    kind: 'union',
    name: fullName,
    props,
  };
}

function serializeArrayType(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type>,
  depth: number,
): PrimitiveType {
  const elem = type.getArrayElementTypeOrThrow();
  return {
    kind: 'primitive',
    name: 'Array',
    constraint: serializeType(elem, sourceFile, seen, depth + 1),
  };
}

function serializeObjectType(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type>,
  depth: number,
): ObjectType {
  const baseName = getBaseName(type);
  const props: Record<string, SerializedType> = {};
  for (const prop of type.getProperties()) {
    const decl = prop.getDeclarations()?.[0];
    const propType = decl
      ? prop.getTypeAtLocation(decl)
      : prop.getDeclaredType();

    props[prop.getName()] = serializeType(
      propType,
      sourceFile,
      seen,
      depth + 1,
    );
  }
  return {
    kind: 'object',
    name: baseName,
    props,
    importPath: getImportPathFromType(type),
  };
}

function getIntersectionName(rootType: Type, types: SerializedType[]): string {
  const rootBase = getBaseName(rootType);
  const joinedInner = types.map((t) => cleanImportName(t.name)).join(' & ');
  return `${rootBase}<${joinedInner}>`;
}

/*
function getImportPathFromType(type: Type): string | undefined {
  const importPathSymbol = type.getSymbol();
  return importPathSymbol
    ? getImportPathForSymbol(importPathSymbol)
    : undefined;
} */

function getImportPathFromType(type: Type): string | undefined {
  const symbol = type.getSymbol();
  const decl = symbol?.getDeclarations()?.[0];
  const filePath = decl?.getSourceFile().getFilePath();

  if (!filePath) return undefined;

  return getModuleNameFromFilePath(filePath);
}

function getModuleNameFromFilePath(filePath: string): string | undefined {
  const nodeModulesIndex = filePath.indexOf('node_modules/');
  if (nodeModulesIndex === -1) return undefined;

  const subpath = filePath.slice(nodeModulesIndex + 'node_modules/'.length);
  const segments = subpath.split('/');

  const isScoped = segments[0].startsWith('@');
  return cleanImportPath(
    isScoped ? `${segments[0]}/${segments[1]}` : segments[0],
  );
}

function serializeImportRefObject(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type>,
  depth: number,
): ImportRefObjectType | ImportRefType {
  const typeArgs =
    type.getAliasTypeArguments?.() ?? type.getTypeArguments?.() ?? [];
  const inner = typeArgs[0];

  if (inner?.isIntersection()) {
    const innerTypes = inner.getIntersectionTypes().map((t) => {
      const serialized = serializeType(t, sourceFile, seen, depth + 1);
      if (
        (serialized.kind === 'object' ||
          serialized.kind === 'importRef' ||
          serialized.kind === 'importRefObject') &&
        serialized.name.startsWith('import("')
      ) {
        return { ...serialized, name: cleanImportName(serialized.name) };
      }
      return serialized;
    });

    const mergedProps: Record<string, SerializedType> = {};
    for (const t of innerTypes) {
      if (t.kind === 'object' || t.kind === 'importRefObject') {
        Object.assign(mergedProps, t.props);
      }
    }

    return {
      kind: 'importRefObject',
      name: getIntersectionName(type, innerTypes),
      types: innerTypes,
      props: mergedProps,
      importPath: getImportPathFromType(type),
    };
  }

  return {
    kind: 'importRef',
    name: getBaseName(type),
    importPath: getImportPathFromType(type),
  };
}

function resolveImportAliasRef(
  type: Type,
  sourceFile: SourceFile,
): SerializedType | null {
  const rawName = type.getText();
  if (!rawName.startsWith('import("')) return null;

  const allImports = sourceFile.getImportDeclarations();
  for (const imp of allImports) {
    const ns = imp.getNamespaceImport();
    if (!ns) continue;

    const importText = rawName.match(/^import\("(.+?)"\)\.(.+)$/);
    if (!importText) continue;

    const [, importPath, member] = importText;
    const resolved = imp.getModuleSpecifierSourceFile()?.getFilePath();
    if (resolved && resolved.includes(importPath)) {
      const alias = ns.getText();
      const reconstructed = `${alias}.${member}`;
      if (
        IMPORT_REF_PREFIXES.some((prefix) => reconstructed.startsWith(prefix))
      ) {
        return { kind: 'importRef', name: reconstructed, importPath };
      }
    }
  }
  return null;
}
function serializeClassType(
  type: Type,
  sourceFile: SourceFile,
  seen: WeakSet<Type> = new WeakSet(),
  depth: number = 0,
): ObjectType {
  return serializeObjectType(type, sourceFile, seen, depth);
}

function serializeMappedType(
  type: Type,
  aliasName: string,
  sourceFile: SourceFile,
  seen = new WeakSet<Type>(),
  depth = 0,
): MappedType {
  const typeArguments = type.getAliasTypeArguments?.() || [];

  const [T, K] = typeArguments;

  return {
    kind: 'mapped',
    name: aliasName,
    typeArguments: {
      ...(T && { T: serializeType(T, sourceFile, seen, depth + 1) }),
      ...(K && { K: serializeType(K, sourceFile, seen, depth + 1) }),
    },
  };
}
function resolveImportRefFromType(
  type: Type,
  sourceFile: SourceFile,
): ImportRefType | undefined {
  const rawName = type.getText(sourceFile);

  const match = rawName.match(/^typeof import\(".*node_modules\/(.+?)"\)/);
  if (!match) return;

  const fullPath = match[1]; // e.g. "@apollo/client/index.d.ts"
  const segments = fullPath.split('/');

  const isScoped = segments[0].startsWith('@');
  const importPath = cleanImportPath(
    isScoped ? `${segments[0]}/${segments[1]}` : segments[0],
  );

  return {
    kind: 'importRef',
    name: `typeof import("${importPath}")`,
    importPath,
  };
}

function cleanImportPath(path: string): string {
  return path.replace('@types/', '');
}

function isExportEqualsModule(decl: Node | undefined): boolean {
  const sourceFile = decl?.getSourceFile();
  const hasExportEquals = sourceFile
    ?.getExportAssignments()
    .some((e) => e.isExportEquals());
  if (hasExportEquals) return true;
  // ✅ Also handle "declare module 'foo' { export default ... }"
  const moduleDecl = decl?.getFirstAncestorByKind(
    ts.SyntaxKind.ModuleDeclaration,
  );
  if (moduleDecl && moduleDecl.getName().startsWith("'")) {
    const exports = moduleDecl.getDescendantsOfKind(
      ts.SyntaxKind.ExportAssignment,
    );
    return exports.some((e) => !e.isExportEquals());
  }

  return false;
}

function getPossibleNamesFromExportAssignment(
  ea: ExportAssignment,
  sourceFile: SourceFile,
): string[] {
  const choices: string[] = [];
  const expression = ea.getExpression();
  if (Node.isIdentifier(expression)) {
    const name = expression.getText();
    choices.push(name);
    const nodes = queryTsMorphNode(sourceFile, `Identifier[name="${name}"]`)
      .map((node) => node.getParent())
      .filter(Boolean);
    nodes.forEach((node) => {
      if (Node.isVariableDeclaration(node)) {
        choices.push(node.getType().getText());
      }
    });
  }
  return choices;
}
function getExportModuleNames(decl: Node | undefined): string[] {
  const sourceFile = decl?.getSourceFile();
  if (!sourceFile) return [];
  const hasExportEquals = sourceFile
    .getExportAssignments()
    .filter((e) => e.isExportEquals())
    .flatMap((e) => getPossibleNamesFromExportAssignment(e, sourceFile));
  if (hasExportEquals?.length) return hasExportEquals;
  // ✅ Also handle "declare module 'foo' { export default ... }"
  const moduleDecl = decl?.getFirstAncestorByKind(
    ts.SyntaxKind.ModuleDeclaration,
  );
  if (moduleDecl && moduleDecl.getName().startsWith("'")) {
    const exports = moduleDecl.getDescendantsOfKind(
      ts.SyntaxKind.ExportAssignment,
    );
    return exports
      .filter((e) => !e.isExportEquals())
      .flatMap((e) => getPossibleNamesFromExportAssignment(e, sourceFile));
  }

  return [];
}
function resolveExportEqualsImportRef(
  type: Type,
  sourceFile: SourceFile,
): ImportRefType | undefined {
  const symbol = type.getSymbol();
  const targetName = symbol?.getName();
  const decl = symbol?.getDeclarations()?.[0];

  if (!isExportEqualsModule(decl)) return;
  /**
   * In some cases you will have an export module declared like so
   *      declare const Mousetrap: Mousetrap.MousetrapStatic;
   *      export = Mousetrap;
   *      export as namespace Mousetrap;
   * In this case the `type` would have resolved to `Mousetrap.MousetrapStatic`.
   * In this case we want to get all the exported names to see if the resolved `type` matches any
   */
  const exportNames = getExportModuleNames(decl);

  /**
   * Since the import came from your source file
   * and you already know the type refers to an external symbol, scan your source file directly:
   */
  const imports = sourceFile.getImportDeclarations();

  const possibleImportPaths: string[] = [];
  for (const importDecl of imports) {
    const defaultImport = importDecl.getDefaultImport();
    if (!defaultImport) continue;

    /**
     * This does a deeper match:
     *
     * It checks if the default import is an alias for the same declaration as the type symbol.
     *
     * So import Mousetrap resolving to export = Mousetrap → matches MousetrapStatic properly.
     */
    const importSymbol = defaultImport.getSymbol();
    const aliased = importSymbol?.getAliasedSymbol();
    const aliasedName = aliased?.getName();
    const importedDecl = aliased?.getDeclarations()?.[0];
    const importPath = importDecl.getModuleSpecifierValue();

    // Prefer: exact match
    if (importedDecl === decl) {
      return {
        kind: 'importRef',
        name: `typeof import("${importPath}")`,
        importPath,
      };
    }

    // Fallback: compare names (string match)
    if (
      aliasedName === targetName ||
      importSymbol?.getName() === targetName ||
      (aliasedName && exportNames.includes(aliasedName))
    ) {
      return {
        kind: 'importRef',
        name: `typeof import("${importPath}")`,
        importPath,
      };
    }
    /**
     * matches cases like
     * import Mousetrap from 'mousetrap';
     * // .d.ts
     * declare const Mousetrap: Mousetrap.MousetrapStatic;
     *
     * export = Mousetrap;
     *
     * export as namespace Mousetrap;
     */
    if (aliasedName && targetName?.startsWith(aliasedName)) {
      possibleImportPaths.push(importPath);
    }
  }
  const exactMatch = possibleImportPaths.find((p) => p === targetName);
  if (exactMatch) {
    return {
      kind: 'importRef',
      name: `typeof import("${exactMatch}")`,
      importPath: exactMatch,
    };
  }
}
// --- Main Serializer ---
export function serializeType(
  type: Type,
  sourceFile: SourceFile,
  seen = new WeakSet<Type>(),
  depth = 0,
): SerializedType {
  if (depth > MAX_DEPTH)
    return { kind: 'primitive', name: '[MaxDepthExceeded]' };

  const rawName = type.getText();

  const typeofImportMatch = rawName.match(
    /^typeof import\(".*node_modules\/(.+?)"\)/,
  );
  if (typeofImportMatch) {
    const fullPath = typeofImportMatch[1]; // e.g. "@apollo/client/index.d.ts"
    const segments = fullPath.split('/');

    const isScoped = segments[0].startsWith('@');
    const importPath = cleanImportPath(
      isScoped ? `${segments[0]}/${segments[1]}` : segments[0],
    );

    // Remove common suffixes like dist or index.* after the package name
    const trimmedSegments = segments.slice(0, isScoped ? 2 : 1); // start with just the importPath
    if (trimmedSegments[0] == '@types') {
      trimmedSegments.shift();
    }

    return {
      kind: 'importRef',
      name: `typeof import("${trimmedSegments.join('/')}")`,
      importPath,
    };
  }

  const baseName = getBaseName(type);

  const aliasSymbol = type.getAliasSymbol();
  const aliasName = aliasSymbol?.getName();

  const isMappedUtility = (name: string | undefined): name is string =>
    [
      'Pick',
      'Omit',
      'Partial',
      'Required',
      'Readonly',
      'Record',
      'Exclude',
      'Extract',
      'NonNullable',
    ].includes(name || '');

  if (aliasName && isMappedUtility(aliasName)) {
    return serializeMappedType(type, aliasName, sourceFile, seen, depth);
  }
  if (isPrimitiveType(type)) return { kind: 'primitive', name: rawName };
  if (seen.has(type)) return { kind: 'primitive', name: baseName };
  seen.add(type);

  if (type.isUnion()) return serializeUnionType(type, sourceFile, seen, depth);
  if (isClassOrAbstract(type)) {
    return serializeClassType(type, sourceFile, seen, depth);
  }
  // CommonJS-style `export =` default import (e.g., Mousetrap)
  const exportEqualsImportRef = resolveExportEqualsImportRef(type, sourceFile);
  if (exportEqualsImportRef) return exportEqualsImportRef;

  const importRef = resolveImportRefFromType(type, sourceFile);
  if (importRef) return importRef;

  if (type.getCallSignatures().length > 0)
    return serializeFunctionType(type, sourceFile, seen, depth);
  if (rawName === 'React.FC') return { kind: 'empty', name: 'React.FC' };
  if (rawName === 'React.PropsWithChildren<{}>')
    return { kind: 'reactNode', name: rawName };
  if (IMPORT_REF_PREFIXES.some((prefix) => rawName.startsWith(prefix)))
    return serializeImportRefObject(type, sourceFile, seen, depth);
  if (type.isArray()) return serializeArrayType(type, sourceFile, seen, 0);

  const resolvedImport = resolveImportAliasRef(type, sourceFile);
  if (resolvedImport) return resolvedImport;

  const remapped = remapImportedLibrary(type);
  if (remapped) return remapped;

  if (baseName === 'RegExp' && isExternalLibraryType(type))
    return { kind: 'primitive', name: 'RegExp' };
  if (isStandardLibType(type))
    return {
      kind: 'importRef',
      name: baseName,
      importPath: getImportPathForSymbol(type.getSymbol()!),
    };
  if (isExternalLibraryType(type))
    return {
      kind: 'importRef',
      name: baseName,
      importPath: getImportPathForSymbol(type.getSymbol()!),
    };

  const objectResult = serializeObjectType(type, sourceFile, seen, depth);
  return Object.keys(objectResult.props).length > 0
    ? objectResult
    : { kind: 'primitive', name: baseName };
}

// --- Type Alias Support ---
export function serializeTypeAlias(
  alias: TypeAliasDeclaration,
  sourceFile: SourceFile,
): SerializedType {
  const type = alias.getType();
  const base = serializeType(type, sourceFile);
  switch (base.kind) {
    case 'object':
    case 'function':
    case 'union':
    case 'importRefObject':
      return { ...base, name: alias.getName() };
    default:
      return base;
  }
}

function serializeInitializer(
  initializer: Node,
  sourceFile: SourceFile,
): SerializedType {
  // --- Case 1: Object literal ---
  if (Node.isObjectLiteralExpression(initializer)) {
    return serializeObjectLiteralExpression(initializer, sourceFile);
  }

  // --- Case 2: Array literal ---
  if (Node.isArrayLiteralExpression(initializer)) {
    const elements = initializer.getElements();
    const constraints = elements.map((el) =>
      serializeInitializer(el, sourceFile),
    );

    const unified =
      constraints.length === 0
        ? undefined
        : constraints.every(
              (c) => JSON.stringify(c) === JSON.stringify(constraints[0]),
            )
          ? constraints[0]
          : ({
              kind: 'union',
              name: 'mixed',
              props: constraints,
            } as UnionType);

    return {
      kind: 'primitive',
      name: 'Array',
      ...(unified ? { constraint: unified } : {}),
    };
  }

  // --- Case 3: Walk back from symbol to import ---
  const symbol = initializer.getSymbol?.();
  const decl = symbol?.getDeclarations()?.[0];

  const importDecl = decl?.getFirstAncestorByKind(
    ts.SyntaxKind.ImportDeclaration,
  );
  const importPath = importDecl?.getModuleSpecifierValue();

  if (importPath) {
    return {
      kind: 'importRef',
      name: `typeof import("${importPath}")`,
      importPath,
    };
  }

  // --- Fallback: serialize as type ---
  const type = decl?.getType?.() ?? initializer.getType?.();

  if (!type) {
    return { kind: 'primitive', name: 'unknown' };
  }

  return serializeType(type, sourceFile);
}
export function serializeObjectLiteralExpression(
  expr: ObjectLiteralExpression,
  sourceFile: SourceFile,
): ObjectType {
  const props: Record<string, SerializedType> = {};

  for (const prop of expr.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      const initializer = prop.getInitializerOrThrow();
      props[name] = serializeInitializer(initializer, sourceFile);
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      const symbol = prop.getSymbol();

      if (symbol) {
        const decl = symbol.getDeclarations()?.[0];

        const resolvedType = decl?.getType?.();
        props[name] = resolvedType
          ? serializeType(resolvedType, sourceFile)
          : { kind: 'primitive', name: 'unknown' };
      } else {
        props[name] = { kind: 'primitive', name: 'unknown' };
      }
    } else if (Node.isMethodDeclaration(prop)) {
      const name = prop.getName();
      const returnType = prop.getReturnType();
      const parameters = prop.getParameters().map((p) => ({
        name: p.getName(),
        type: serializeType(p.getType(), sourceFile),
      }));

      props[name] = {
        kind: 'function',
        name,
        args: Object.fromEntries(parameters.map((p) => [p.name, p.type])),
        returnType: serializeType(returnType, sourceFile),
      };
    } else if (Node.isSpreadAssignment(prop)) {
      const exprText = prop.getExpression().getText();
      const spreadType = prop.getExpression().getType();

      props[`...${exprText}`] = serializeType(spreadType, sourceFile);
    }
  }
  const parent = expr.getParent();
  let name = 'AnonymousObject';
  if (Node.isVariableDeclaration(parent)) name = parent.getName();
  if (Node.isPropertyAssignment(parent)) name = parent.getNameNode().getText();

  return {
    kind: 'object',
    name,
    props,
  };
}
