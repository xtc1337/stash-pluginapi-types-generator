import { getProject, getStashFilePath, STASH_UI_DIR } from '../utils';
import path from 'path';
import { BuilderContext, TypeRegistry } from '../builders';
import { CodeBlockWriter, Project } from 'ts-morph';
import { writeFileSync } from 'node:fs';

export function getTestProject() {
  return getProject(getStashFilePath('tsconfig.json'));
}

export function testContext(): BuilderContext {
  return {
    project: getTestProject(),
    writer: new CodeBlockWriter(),
    typeRegistry: new TypeRegistry(),
    logger: console,
    fs: {
      writeFileSync,
    },
  };
}

export function getStashSourceFile(project: Project, uri: string) {
  return project.getSourceFileOrThrow(getStashFilePath(uri));
}
