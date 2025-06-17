import {
  Node,
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
  ObjectType,
  PrimitiveType,
  SerializedType,
} from './types';

// --- Constants ---
const IMPORT_REF_PREFIXES = ['React.', 'ReactDOM.', 'GQL.', 'JSX.'];
const IMPORT_PREFIX_MAP: Record<string, string> = {
  gql: 'PluginApi.GQL',
  'react-bootstrap': 'PluginApi.libraries.Bootstrap',
};
const MAX_DEPTH = 4;

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
  const decl = symbol.getDeclarations()?.[0];
  if (!decl) return undefined;

  const importDecl = decl.getFirstAncestorByKind(
    ts.SyntaxKind.ImportDeclaration,
  );
  if (!importDecl) return undefined;

  return importDecl.getModuleSpecifierValue();
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
  const raw = type.getText().split('<')[0].trim();
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
        importPath: pkg,
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
    if (prop.getName() === 'extraCriteria') {
      console.log('found');
    }
    props[prop.getName()] = serializeType(
      propType,
      sourceFile,
      seen,
      depth + 1,
    );
  }
  return { kind: 'object', name: baseName, props };
}

function getIntersectionName(rootType: Type, types: SerializedType[]): string {
  const rootBase = getBaseName(rootType);
  const joinedInner = types.map((t) => cleanImportName(t.name)).join(' & ');
  return `${rootBase}<${joinedInner}>`;
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
      importPath: type.getSymbol()
        ? getImportPathForSymbol(type.getSymbol())
        : undefined,
    };
  }

  return {
    kind: 'importRef',
    name: getBaseName(type),
    importPath: getImportPathForSymbol(type.getSymbol()!),
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
  };
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
  const baseName = getBaseName(type);

  if (isPrimitiveType(type)) return { kind: 'primitive', name: rawName };
  if (seen.has(type)) return { kind: 'primitive', name: baseName };
  seen.add(type);

  if (type.isUnion()) return serializeUnionType(type, sourceFile, seen, depth);
  if (isClassOrAbstract(type)) {
    return serializeClassType(type, sourceFile, seen, depth);
  }
  if (type.getCallSignatures().length > 0)
    return serializeFunctionType(type, sourceFile, seen, depth);
  if (rawName === 'React.FC') return { kind: 'empty', name: 'React.FC' };
  if (rawName === 'React.PropsWithChildren<{}>')
    return { kind: 'reactNode', name: rawName };
  if (IMPORT_REF_PREFIXES.some((prefix) => rawName.startsWith(prefix)))
    return serializeImportRefObject(type, sourceFile, seen, depth);
  if (type.isArray()) return serializeArrayType(type, sourceFile, seen, depth);

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
