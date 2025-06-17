import { getProject } from '../utils';
import path from 'path';
import { BuilderContext, TypeRegistry } from '../builders';
import { CodeBlockWriter, Project } from 'ts-morph';

export const STASH_DIR = path.join(__dirname, '..', '..', 'stash');
export const STASH_UI_DIR = path.join(STASH_DIR, 'ui', 'v2.5');
export function getTestProject() {
  return getProject(path.join(STASH_UI_DIR, 'tsconfig.json'));
}

export function testContext(): BuilderContext {
  return {
    writer: new CodeBlockWriter(),
    typeRegistry: new TypeRegistry(),
    logger: console,
  };
}

export function getStashFilePath(uri: string) {
  return path.join(STASH_UI_DIR, uri);
}
export function getStashSourceFile(project: Project, uri: string) {
  return project.getSourceFileOrThrow(getStashFilePath(uri));
}
