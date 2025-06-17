import { CodeBlockWriter, SourceFile } from 'ts-morph';
import { TypeRegistry } from './type-registry';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export type DeepPartial<T> = T extends (...args: Any[]) => Any
  ? T
  : T extends object
    ? {
        [P in keyof T]?: T[P] extends (infer U)[]
          ? DeepPartial<U>[]
          : T[P] extends ReadonlyArray<infer U>
            ? ReadonlyArray<DeepPartial<U>>
            : T[P] extends (...args: Any[]) => Any
              ? T[P]
              : T[P] extends object
                ? DeepPartial<T[P]>
                : T[P];
      }
    : T;

export type BuilderContext = {
  readonly writer: CodeBlockWriter;
  readonly typeRegistry: TypeRegistry;
  readonly logger: typeof console;
};
export interface ITypeBuilder {
  process(sourceFile: SourceFile, context: BuilderContext): void;
  write(context: BuilderContext): void;
}
