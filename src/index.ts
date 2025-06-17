import { CodeBlockWriter, Project } from 'ts-morph';
import * as path from 'path';
import { componentsBuilder } from './builders';
import { Context, ObjectType, SerializedType } from './types';

const tsConfigFilePath = path.resolve(__dirname, '../tsconfig.json');
const project = new Project({
  tsConfigFilePath,
});

const sourceFiles = project.getSourceFiles();
const TYPES: Record<string, Record<string, SerializedType>> = {};

const BUILDERS = [componentsBuilder];
const writer = new CodeBlockWriter();

const ctx: Context = {
  addType(typeDef: ObjectType) {
    if (!TYPES[typeDef.name]) {
      TYPES[typeDef.name] = typeDef.props;
    }

    Object.keys(typeDef.props).forEach((prop) => {
      const def = typeDef.props[prop];

      if (def.kind === 'object') {
        this.addType(def);
      }
      if (def.kind === 'function' && def.returnType.kind === 'object') {
        this.addType(def.returnType);
      }
    });
  },
};

sourceFiles.forEach((sf) => {
  if (sf.getFilePath().includes('node_modules')) return;
  if (!sf.getBaseName().endsWith('.ts') && !sf.getBaseName().endsWith('.tsx'))
    return;
  BUILDERS.forEach((builder) => builder.process(sf, ctx));
});
componentsBuilder.write(ctx, writer);

console.log(writer.toString());
