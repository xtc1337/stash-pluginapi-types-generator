import {
  ArrowFunction,
  CallExpression,
  FunctionExpression,
  Identifier,
  Node,
  SourceFile,
} from 'ts-morph';
import { queryTsMorphNode } from '../utils';
import {
  EmptyType,
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

  if (param.getText().includes('React.PropsWithChildren<{}>'))
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
    return {
      name,
      ...resolveFunctionInfo(functionNode),
    };
  }
  public write({ writer }: BuilderContext): void {
    writer.writeLine('export const components = {');
    this.componentInfos.forEach(({ name, propsType }) => {
      writer.writeLine(`'\t${name}': ${propsType.name},`);
    });
    writer.writeLine('}');
  }
}

export const componentsBuilder = new ComponentsBuilder();
