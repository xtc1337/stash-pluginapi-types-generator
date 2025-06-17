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
};

export type FunctionType = {
  kind: 'function';
  name: string;
  args: Record<string, SerializedType>;
  returnType: SerializedType;
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

export type SerializedType =
  | PrimitiveType
  | ObjectType
  | FunctionType
  | UnionType
  | ImportRefType
  | ImportRefObjectType
  | EmptyType
  | ReactNodeType;

export type Context = {
  addType(typeDef: ObjectType): void;
};
