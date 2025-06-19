import {
  ArrowFunction,
  CallExpression,
  FunctionExpression,
  Identifier,
  Node,
  SourceFile,
} from 'ts-morph';
import { normalizePath, queryTsMorphNode } from '../utils';
import {
  EmptyType,
  isImportRefObjectType,
  isObjectType,
  maybeConvertLocalImportPath,
  ReactNodeType,
  SerializedType,
  serializeType,
} from '../ast';

import { BuilderContext, DeepPartial, ITypeBuilder } from './types';

function toArrowFunctionFromIdentifier(
  node: Identifier,
): ArrowFunction | undefined {
  const symbol = node.getSymbol();
  const decl = symbol?.getDeclarations().find(Node.isVariableDeclaration);
  const init = decl?.getInitializer();

  return Node.isArrowFunction(init) ? init : undefined;
}

function resolveFunctionInfo(node: ArrowFunction | FunctionExpression) {
  const sourceFile = node.getSourceFile();
  const param = node.getParameters()[0];
  if (!param)
    return {
      propsType: {
        kind: 'empty',
        name: 'React.FC',
      } as EmptyType,
    };

  const parmText = param.getText();
  if (parmText.includes('React.PropsWithChildren<{}>'))
    return {
      propsType: {
        kind: 'reactNode',
        name: 'React.PropsWithChildren<{}>',
      } as ReactNodeType,
    };

  return {
    propsType: serializeType(param.getType(), sourceFile),
  };
}
type ComponentInfo = {
  name: string;
  propsType: SerializedType;
  importPath?: string;
};

const TO_OMIT = ['patch.tsx'];

export type ComponentsBuilderHooks = {
  forEachNode: (node: CallExpression) => boolean;
  beforeResolveFunctionInfo: (node: CallExpression, name: string) => boolean;
};
export type ComponentsBuilderConfig = {
  omit: string[];
  hooks: ComponentsBuilderHooks;
};

export const defaultComponentsBuilderConfig: ComponentsBuilderConfig = {
  omit: TO_OMIT,
  hooks: {
    forEachNode: (() => true) as ComponentsBuilderHooks['forEachNode'],
    beforeResolveFunctionInfo: (() =>
      true) as ComponentsBuilderHooks['beforeResolveFunctionInfo'],
  },
};

export const setComponentsBuilderConfigDefaults = (
  config?: DeepPartial<ComponentsBuilderConfig>,
): ComponentsBuilderConfig => {
  if (!config) {
    return defaultComponentsBuilderConfig;
  }

  return {
    omit: config.omit ?? defaultComponentsBuilderConfig.omit,
    hooks: {
      forEachNode:
        config.hooks?.forEachNode ??
        defaultComponentsBuilderConfig.hooks.forEachNode,
      beforeResolveFunctionInfo:
        config.hooks?.beforeResolveFunctionInfo ??
        defaultComponentsBuilderConfig.hooks.beforeResolveFunctionInfo,
    },
  };
};

function getImportValueType(
  type: SerializedType,
  propsType: SerializedType,
): string | undefined {
  if (!isObjectType(type)) return;
  if (propsType.name.startsWith('{')) {
    // already resolved
    return propsType.name;
  }
  const filePath = normalizePath(type.filePath);
  if (!filePath.includes('v2.5/src/')) return;

  const valueType = (filePath.split('v2.5/src/').pop() as string).replace(
    /\.(tsx|ts)$/,
    '',
  );

  return `typeof import ("./${valueType}").${propsType.name}`;
}
export class ComponentsBuilder implements ITypeBuilder {
  private _componentInfos: ComponentInfo[] = [];
  private readonly config: ComponentsBuilderConfig;

  constructor(config: DeepPartial<ComponentsBuilderConfig> = {}) {
    this.config = setComponentsBuilderConfigDefaults(config);
  }
  get componentInfos(): ReadonlyArray<ComponentInfo> {
    return this._componentInfos;
  }
  public process(sourceFile: SourceFile, ctx: BuilderContext): void {
    // Move existing processing logic here
    // This makes it testable in isolation
    const nodes = queryTsMorphNode<CallExpression>(
      sourceFile,
      'CallExpression:has(Identifier[name=PatchComponent])',
    );
    if (nodes.length === 0) return;
    nodes.forEach((node) => {
      if (!this.config.hooks.forEachNode(node)) return;

      try {
        const componentInfo = this.toComponentInfo(node);
        if (!componentInfo) {
          ctx.logger.error('MISSING ARROW FUNCTION', sourceFile.getFilePath());
          return;
        }

        const { propsType } = componentInfo;

        if (propsType.kind === 'object') {
          ctx.typeRegistry.addType(propsType);
        }
        ctx.logger.log(`Found component ${componentInfo.name}`);
        this._componentInfos.push(componentInfo);
      } catch (e) {
        console.log(sourceFile.getFilePath());
        throw e;
      }
    });
  }
  private toComponentInfo(node: CallExpression) {
    const args = node.getArguments();
    if (args.length !== 2) return undefined;
    const [nameNode, callbackNode] = args;
    if (!Node.isStringLiteral(nameNode)) return undefined;
    if (
      !Node.isArrowFunction(callbackNode) &&
      !Node.isIdentifier(callbackNode) &&
      !Node.isFunctionExpression(callbackNode)
    ) {
      return {
        name: nameNode.getLiteralValue(),
        propsType: {
          kind: 'empty',
          name: 'React.FC',
        } as EmptyType,
      };
    }

    const functionNode = Node.isIdentifier(callbackNode)
      ? toArrowFunctionFromIdentifier(callbackNode)
      : callbackNode;

    if (!functionNode) return undefined;
    const name = nameNode.getLiteralValue();
    if (!this.config.hooks.beforeResolveFunctionInfo(node, name))
      return undefined;
    if (name === 'ChangeButtonSetting') {
      console.log(name);
    }
    const functionInfo = resolveFunctionInfo(functionNode);
    const importPath = maybeConvertLocalImportPath(
      node.getSourceFile().getFilePath(),
      functionInfo.propsType.name,
    );
    return {
      name,
      ...functionInfo,
      importPath,
    };
  }
  public write({ writer, typeRegistry }: BuilderContext): void {
    writer.writeLine('export interface PatchableComponents {');
    this.componentInfos.forEach((info) => {
      const { name, propsType, importPath } = info;

      if (name === 'ChangeButtonSetting') {
        console.log(name);
      }
      let valueType = propsType.name;
      const type =
        isObjectType(propsType) &&
        typeRegistry.getType(propsType.name, propsType.filePath);

      if (type) {
        if (isObjectType(type)) {
          if (type.importPath) {
            valueType = `React.FC<typeof ${type.importPath}>`;
          } else {
            valueType = getImportValueType(type, propsType) ?? valueType;
          }
        }
      } else if (isImportRefObjectType(propsType)) {
        valueType = propsType.types.reduce((acc, refType) => {
          return acc.replace(
            refType.name,
            getImportValueType(refType, refType) ?? refType.name,
          );
        }, valueType);
      } else {
        // console.log(name, propsType.name, propsType.kind);
      }

      writer.writeLine(`\t'${name}': ${valueType},`);
    });
    writer.writeLine('}');
  }
}

export const componentsBuilder = new ComponentsBuilder();
