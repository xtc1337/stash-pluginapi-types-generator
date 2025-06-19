import { Node, ObjectLiteralExpression, SourceFile, ts, Type } from 'ts-morph';
import { ObjectType, SerializedType, TypeDefRefType, UnionType } from './types';
import { serializeFunctionType, serializeType } from './serializeType';

function maybeSerializeTypeDefRef(type: Type): TypeDefRefType | undefined {
  const symbol = type.getSymbol() ?? type.getAliasSymbol();
  const decl = symbol?.getDeclarations()?.[0];

  if (!decl) return;

  const importDecl = decl.getFirstAncestorByKind(
    ts.SyntaxKind.ImportDeclaration,
  );
  const importPath = importDecl?.getModuleSpecifierValue();

  const isRelativeOrSrc =
    importPath?.startsWith('./') ||
    importPath?.startsWith('../') ||
    importPath?.startsWith('src/');

  if (importPath && isRelativeOrSrc) {
    return {
      kind: 'typeDefRef',
      name: symbol.getName(),
      importPath,
    };
  }
}
export function serializeMaybeImportRef(
  initializer: Node,
  sourceFile: SourceFile,
): SerializedType | undefined {
  const symbol = initializer.getSymbol();
  const aliased = symbol?.getAliasedSymbol();
  const resolvedSymbol = aliased ?? symbol;
  const decl = resolvedSymbol?.getDeclarations()?.[0];

  // You may still want this to debug or match importPath later
  const importDecl = decl?.getFirstAncestorByKind(
    ts.SyntaxKind.ImportDeclaration,
  );
  const importPath = importDecl?.getModuleSpecifierValue();

  const type = resolvedSymbol?.getTypeAtLocation(initializer);
  if (type) {
    // check if the type is coming from an local type.. since this method is only called when examining pluginApi.tsx we want to check here
    // vs adding this check in `serializeType`
    const typeDefRef = maybeSerializeTypeDefRef(type);
    if (typeDefRef) return typeDefRef;
    return serializeType(type, sourceFile);
  }
  if (importPath) {
    return {
      kind: 'importRef',
      name: `typeof import("${importPath}")`,
      importPath,
    };
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

  // Handle function expressions (arrow or traditional)
  if (
    Node.isFunctionExpression(initializer) ||
    Node.isArrowFunction(initializer)
  ) {
    return serializeFunctionType(
      initializer.getType(),
      sourceFile,
      new WeakSet(),
      0,
    );
  }

  // Handle identifiers (may be imports or local symbols)
  if (Node.isIdentifier(initializer)) {
    const importRef = serializeMaybeImportRef(initializer, sourceFile);
    if (importRef) return importRef;
  }

  // Default fallback
  return {
    kind: 'primitive',
    name: 'unknown',
  };
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
    filePath: sourceFile.getFilePath(),
  };
}
