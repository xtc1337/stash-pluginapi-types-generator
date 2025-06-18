import { BuilderContext, ITypeBuilder } from './types';
import { ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { ObjectType, serializeObjectLiteralExpression } from '../ast';
import { queryTsMorphNode } from '../utils';

export class NamespaceBuilder implements ITypeBuilder {
  private _objectTypes: ObjectType[] = [];
  constructor(private readonly ns: string[]) {}
  process(sourceFile: SourceFile, _ctx: BuilderContext): void {
    if (!sourceFile.getFilePath().includes('src/pluginApi.tsx')) return;
    if (!this.ns.length) return;
    this.ns.forEach((ns) => {
      const node = this.getObjectLiteralExpression(sourceFile, ns);
      if (!node) return;
      this._objectTypes.push(
        serializeObjectLiteralExpression(node, sourceFile),
      );
    });
  }
  get objectTypes(): ObjectType[] {
    return this._objectTypes;
  }
  protected getObjectLiteralExpression(sourceFile: SourceFile, ns: string) {
    const [node] = queryTsMorphNode<ObjectLiteralExpression>(
      sourceFile,
      `PropertyAssignment:has(Identifier[name="${ns}"]) ObjectLiteralExpression`,
    );
    return node;
  }

  write(): void {}
}
