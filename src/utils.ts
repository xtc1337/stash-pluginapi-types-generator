import type { CompilerNodeToWrappedType, ts } from 'ts-morph';
import { Node } from 'ts-morph';
import { tsquery } from '@phenomnomnominal/tsquery';

/**
 * _getNodeFromCompilerNode is not emitted on ts-morph's Node class so we
 * use this type to cast to the shape to retain type safety
 * Note: Since this is a private method it may break over time
 */
type ExtendedNode = Node & {
  _getNodeFromCompilerNode<LocalCompilerNodeType extends ts.Node = ts.Node>(
    compilerNode: LocalCompilerNodeType,
  ): CompilerNodeToWrappedType<LocalCompilerNodeType>;
};
/**
 *  Mostly used when working with TSQuery to find the initial node, this helper
 *  will wrap the node with the TS-Morph api
 * @param node
 * @param compilerNode
 */
export function getNodeFromCompilerNode<
  T extends Node = Node,
  LocalCompilerNodeType extends ts.Node = ts.Node,
>(node: Node, compilerNode: LocalCompilerNodeType) {
  return (node as ExtendedNode)._getNodeFromCompilerNode(
    compilerNode,
  ) as unknown as T;
}
/**
 * Queries for a node using TsQuery but wraps the return nodes with TS-Morph api
 * @param node
 * @param selector
 */
export function queryTsMorphNode<T extends Node = Node>(
  node: Node,
  selector: string,
): T[] {
  // https://gist.github.com/dsherret/826fe77613be22676778b8c4ba7390e7
  return tsquery(node.compilerNode, selector).map((value) =>
    getNodeFromCompilerNode<T>(node, value),
  );
}
