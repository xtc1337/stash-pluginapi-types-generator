import { CompilerNodeToWrappedType, Node, Project, ts } from 'ts-morph';
import { tsquery } from '@phenomnomnominal/tsquery';
import path from 'path';
import { join, normalize } from 'node:path';

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
export const STASH_DIR = path.join(__dirname, '..', '..', 'stash');
export const STASH_UI_DIR = path.join(STASH_DIR, 'ui', 'v2.5');

export function getStashTsConfigPath() {
  return getStashFilePath('tsconfig.json');
}
export function getStashFilePath(uri: string) {
  return path.join(STASH_UI_DIR, uri);
}
export function getProject(tsConfigFilePath: string) {
  return new Project({
    tsConfigFilePath,
  });
}
export function normalizePath(p: string) {
  return normalize(p).replace(/\\/g, '/');
}
