import { CodeBlockWriter } from 'ts-morph';
import { BuilderContext, componentsBuilder, TypeRegistry } from './builders';
import { getProject, getStashTsConfigPath } from './utils';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stashTypesBuilder } from './builders/stash-types';

const project = getProject(getStashTsConfigPath());

const sourceFiles = project.getSourceFiles();
const BUILDERS = [componentsBuilder, stashTypesBuilder];
const writer = new CodeBlockWriter();

const ctx: BuilderContext = {
  project,
  writer,
  outDir: './dist',
  typeRegistry: new TypeRegistry(),
  logger: console,
  builders: BUILDERS,
  fs: {
    writeFileSync: (filePath: string, data: string) => {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, data);
    },
  },
};

sourceFiles.forEach((sf) => {
  if (sf.getFilePath().includes('node_modules')) return;
  if (!sf.getBaseName().endsWith('.ts') && !sf.getBaseName().endsWith('.tsx'))
    return;
  componentsBuilder.process(sf, ctx);
});

stashTypesBuilder.write(ctx);
