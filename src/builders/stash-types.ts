import { BuilderContext, ITypeBuilder } from './types';
import { MemoryEmitResultFile, Project, SourceFile } from 'ts-morph';
import { getStashTsConfigPath, normalizePath } from '../utils';

import { join, normalize } from 'node:path';
import { StandardizedFilePath } from '@ts-morph/common';
import { ComponentsBuilder } from './components';

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
  if (!file.filePath.endsWith('dist/patch.d.ts')) return file;
  return {
    ...file,
    text: file.text.replace(
      'export declare let components: Record<string, Function>;',
      components,
    ),
  };
}
function path(
  file: MemoryEmitResultFile,
  outDir: string,
): MemoryEmitResultFile {
  const p = file.filePath.split(`dist/`).pop();
  return {
    ...file,
    filePath: p
      ? (normalizePath(join(outDir, p)) as StandardizedFilePath)
      : file.filePath,
  };
}
function index(file: MemoryEmitResultFile): MemoryEmitResultFile {
  if (!file.filePath.endsWith('dist/index.d.ts')) return file;
  return {
    ...file,
    text: `export * from './pluginApi'`,
  };
}
function imports(file: MemoryEmitResultFile): MemoryEmitResultFile {
  return {
    ...file,
    text: file.text.replace(
      /(import*.+from\s+)'([^']+)'/g,
      function (_: string, p1: string, p2: string) {
        if (p2.startsWith('src/')) {
          return p2.replace('src/', './');
        }
        return `${p1}'${p2}'`;
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
        outDir: 'dist',

        // Optional for isolation:
        declarationMap: false,
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
      const adjusted = patch(
        exportInterface(path(index(imports(outputFile)), ctx.outDir)),
        ctx.writer.toString(),
      );
      ctx.logger.debug(`Writing ${adjusted.filePath}`);
      ctx.fs.writeFileSync(adjusted.filePath, adjusted.text);
    }
  }
}

export const stashTypesBuilder = new StashTypesBuilder();
