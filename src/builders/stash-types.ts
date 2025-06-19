import { BuilderContext, ITypeBuilder } from './types';
import { MemoryEmitResultFile, Project } from 'ts-morph';
import { getStashTsConfigPath, normalizePath } from '../utils';

import { dirname, join, relative } from 'node:path';
import { StandardizedFilePath } from '@ts-morph/common';
import { ComponentsBuilder } from './components';

const OUTPUT_DIR = 'dist';

function pluginApi(file: MemoryEmitResultFile): MemoryEmitResultFile {
  if (!file.filePath.endsWith(`${OUTPUT_DIR}/pluginApi.d.ts`)) return file;

  const replacements = [
    [
      'components: Record<string, Function>;',
      'components: PatchableComponents;',
    ],
    [
      'export default PluginApi;',
      `export default PluginApi;\ndeclare global {\n\tinterface Window {\n\t\tPluginApi: typeof PluginApi;\n\t}\n}`,
    ],
    ['} from "./patch"', ', PatchableComponents } from "./patch"'],
  ];
  return {
    ...file,
    text: replacements.reduce((text, [s, r]) => {
      return text.replace(s, r);
    }, file.text),
  };
}
function exportInterface(file: MemoryEmitResultFile) {
  return {
    ...file,
    text: file.text.replace(/^(interface|type )/gm, 'export $1'),
  };
}
function patch(
  file: MemoryEmitResultFile,
  components: string,
): MemoryEmitResultFile {
  if (!file.filePath.endsWith(`${OUTPUT_DIR}/patch.d.ts`)) return file;
  return {
    ...file,
    text: file.text.replace(
      'export declare let components: Record<string, Function>;',
      components,
    ),
  };
}
function path(file: MemoryEmitResultFile): MemoryEmitResultFile {
  const p = file.filePath.split(`${OUTPUT_DIR}/`).pop();
  return {
    ...file,
    filePath: p
      ? (normalizePath(join(OUTPUT_DIR, p)) as StandardizedFilePath)
      : file.filePath,
  };
}
function index(file: MemoryEmitResultFile): MemoryEmitResultFile {
  if (!file.filePath.endsWith(`${OUTPUT_DIR}/index.d.ts`)) return file;
  return {
    ...file,
    text: `export * from './pluginApi'`,
  };
}
function imports(file: MemoryEmitResultFile): MemoryEmitResultFile {
  return {
    ...file,
    text: file.text.replace(
      /(import*.+from\s+)['"]([^"']+)["'];$/gm,
      function (_: string, p1: string, p2: string) {
        if (p2.startsWith('src/')) {
          const filePath = file.filePath.replace(`${OUTPUT_DIR}/`, './');
          const to = p2.replace('src/', '');
          const p = relative(dirname(filePath), to);
          const adjusted = normalizePath(p);

          return `${p1}"${adjusted}"`;
        }
        return `${p1}"${p2}"`;
      },
    ),
  };
}

export class StashTypesBuilder implements ITypeBuilder {
  write(ctx: BuilderContext): void {
    const componentsBuilder = ctx.builders?.find(
      (b) => b instanceof ComponentsBuilder,
    );
    const project = new Project({
      tsConfigFilePath: getStashTsConfigPath(),
      compilerOptions: {
        ...ctx.project.compilerOptions.get(),
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: ctx.outDir,
        preserveConstEnums: true,
        exactOptionalPropertyTypes: true,
        verbatimModuleSyntax: true,
        strict: true,

        // Optional for isolation:

        noEmitOnError: false,
        composite: false,
        skipLibCheck: true,
      },
    });

    componentsBuilder?.write(ctx);
    ctx.logger.log(`Emitting types`);
    const emitResults = project.emitToMemory({
      emitOnlyDtsFiles: true,
    });

    for (const outputFile of emitResults.getFiles()) {
      const adjusted = pluginApi(
        patch(
          exportInterface(index(imports(path(outputFile)))),
          ctx.writer.toString(),
        ),
      );
      ctx.logger.debug(`Writing ${adjusted.filePath}`);
      ctx.fs.writeFileSync(adjusted.filePath, adjusted.text);
    }
  }
}

export const stashTypesBuilder = new StashTypesBuilder();
