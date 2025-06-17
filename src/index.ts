import { CodeBlockWriter } from 'ts-morph';
import * as path from 'path';
import { BuilderContext, componentsBuilder, TypeRegistry } from './builders';
import { getProject } from './utils';

const project = getProject(path.resolve(__dirname, '../tsconfig.json'));

const sourceFiles = project.getSourceFiles();
const BUILDERS = [componentsBuilder];
const writer = new CodeBlockWriter();

const ctx: BuilderContext = {
  writer,
  typeRegistry: new TypeRegistry(),
  logger: console,
};

sourceFiles.forEach((sf) => {
  if (sf.getFilePath().includes('node_modules')) return;
  if (!sf.getBaseName().endsWith('.ts') && !sf.getBaseName().endsWith('.tsx'))
    return;
  BUILDERS.forEach((builder) => builder.process(sf, ctx));
});
componentsBuilder.write(ctx);

console.log(writer.toString());
