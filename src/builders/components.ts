import {
  ArrowFunction,
  CallExpression,
  Identifier,
  Node,
  SourceFile,
  CodeBlockWriter,
  FunctionExpression,
} from 'ts-morph';
import { queryTsMorphNode } from '../utils';
import { serializeType } from '../serializeType';
import { Context, EmptyType, ReactNodeType, SerializedType } from '../types';

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
function toComponentInfo(node: CallExpression) {
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
  return {
    name: nameNode.getLiteralValue(),
    ...resolveFunctionInfo(functionNode),
  };
}
const TO_OMIT = ['patch.tsx'];

const COMPONENTS: ComponentInfo[] = [];

export const componentsBuilder = {
  write(ctx: Context, writer: CodeBlockWriter) {
    writer.writeLine('export const components = {');
    COMPONENTS.forEach(({ name, propsType }) => {
      writer.writeLine(`'\t${name}': ${propsType.name},`);
    });
    writer.writeLine('}');
  },
  process(source: SourceFile, ctx: Context) {
    if (TO_OMIT.includes(source.getBaseName())) return;
    if (!source.getBaseName().includes('GallerySelect.tsx')) return;
    const nodes = queryTsMorphNode<CallExpression>(
      source,
      'CallExpression:has(Identifier[name=PatchComponent])',
    );
    if (nodes.length === 0) return;

    nodes.forEach((node) => {
      try {
        const componentInfo = toComponentInfo(node);
        if (!componentInfo) {
          console.error('MISSING ARROW FUNCTION', source.getFilePath());
          return;
        }
        console.dir(componentInfo, { depth: 5 });
        const { propsType } = componentInfo;
        if (propsType.kind === 'object') {
          ctx.addType(propsType);
        }
        COMPONENTS.push(componentInfo);
      } catch (e) {
        console.log(source.getFilePath());
        throw e;
      }
    });
  },
};
