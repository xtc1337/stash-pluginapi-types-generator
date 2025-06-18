export type PrimitiveType = {
  kind: 'primitive';
  name: string;
  constraint?: SerializedType; // optional for arrays
};

export type EmptyType = {
  kind: 'empty';
  name: 'React.FC';
};

export type ReactNodeType = {
  kind: 'reactNode';
  name: 'React.PropsWithChildren<{}>';
};

export type ObjectType = {
  kind: 'object';
  name: string;
  props: Record<string, SerializedType>;
  importPath?: string;
};

export type FunctionType = {
  kind: 'function';
  name: string;
  args: Record<string, SerializedType>;
  returnType: SerializedType;
  constraint?: SerializedType;
};

export type UnionType = {
  kind: 'union';
  name: string;
  props: SerializedType[];
};

export type ImportRefType = {
  kind: 'importRef';
  name: string;
  importPath?: string;
};

export type ImportRefObjectType = {
  kind: 'importRefObject';
  name: string; // root name like "React.PropsWithChildren"
  types: SerializedType[]; // inner expanded types
  props: Record<string, SerializedType>; // merged from all types
  importPath?: string;
};

export type MappedType = {
  kind: 'mapped';
  name: string;
  typeArguments: {
    T?: SerializedType;
    K?: SerializedType;
  };
};

export type SerializedType =
  | PrimitiveType
  | ObjectType
  | FunctionType
  | UnionType
  | ImportRefType
  | ImportRefObjectType
  | EmptyType
  | ReactNodeType
  | MappedType;

// Type Guards for SerializedType union members
export function isPrimitiveType(type: SerializedType): type is PrimitiveType {
  return type.kind === 'primitive';
}

export function isObjectType(type: SerializedType): type is ObjectType {
  return type.kind === 'object';
}

export function isFunctionType(type: SerializedType): type is FunctionType {
  return type.kind === 'function';
}

export function isUnionType(type: SerializedType): type is UnionType {
  return type.kind === 'union';
}

export function isImportRefType(type: SerializedType): type is ImportRefType {
  return type.kind === 'importRef';
}

export function isImportRefObjectType(
  type: SerializedType,
): type is ImportRefObjectType {
  return type.kind === 'importRefObject';
}

export function isEmptyType(type: SerializedType): type is EmptyType {
  return type.kind === 'empty';
}

export function isReactNodeType(type: SerializedType): type is ReactNodeType {
  return type.kind === 'reactNode';
}

export function isMappedType(type: SerializedType): type is MappedType {
  return type.kind === 'mapped';
}

// Helper function to exhaustively check the type
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

// Example usage of exhaustive type checking
export function processSerializedType(type: SerializedType): string {
  if (isPrimitiveType(type)) {
    return `Primitive: ${type.name}`;
  } else if (isObjectType(type)) {
    return `Object: ${type.name}`;
  } else if (isFunctionType(type)) {
    return `Function: ${type.name}`;
  } else if (isUnionType(type)) {
    return `Union: ${type.name}`;
  } else if (isImportRefType(type)) {
    return `ImportRef: ${type.name}`;
  } else if (isImportRefObjectType(type)) {
    return `ImportRefObject: ${type.name}`;
  } else if (isEmptyType(type)) {
    return `Empty: ${type.name}`;
  } else if (isReactNodeType(type)) {
    return `ReactNode: ${type.name}`;
  } else if (isMappedType(type)) {
    return `Mapped: ${type.name}`;
  } else {
    // This will cause a compile-time error if we haven't handled all cases
    return assertNever(type);
  }
}
