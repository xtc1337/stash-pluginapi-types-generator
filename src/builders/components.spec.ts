import { describe, expect, it } from 'vitest';
import { Project, SourceFile } from 'ts-morph';
import { getStashSourceFile, getTestProject, testContext } from '../test/utils';
import { ComponentsBuilder } from './components';
import { isImportRefObjectType } from '../ast';

describe('components', () => {
  let project: Project;
  const ctx = testContext();
  beforeAll(() => {
    project = getTestProject();
  });
  describe('GallerySelect.tsx', () => {
    let sourceFile: SourceFile;
    let builder: ComponentsBuilder;
    beforeAll(() => {
      builder = new ComponentsBuilder();
      sourceFile = getStashSourceFile(
        project,
        'src/components/Galleries/GallerySelect.tsx',
      );
    });
    it('should extract the component name', () => {
      builder.process(sourceFile, ctx);
      const infos = builder.componentInfos;
      expect(infos).toHaveLength(2);
      expect(infos[0].name).toEqual('GallerySelect');
      expect(infos[1].name).toEqual('GalleryIDSelect');
    });
    it('should extract types correctly', () => {
      builder.process(sourceFile, ctx);
      const [info] = builder.componentInfos;

      expect(info).toEqual(
        expect.objectContaining({
          name: 'GallerySelect',
          propsType: expect.objectContaining({
            kind: 'importRefObject',
            name: 'React.PropsWithChildren<IFilterProps & IFilterValueProps & ExtraGalleryProps>',
          }),
        }),
      );
      const propsType = isImportRefObjectType(info.propsType)
        ? info.propsType
        : undefined;

      expect(propsType?.types).toHaveLength(3);
    });
    it('should infer React.FC<T> types', () => {
      builder.process(
        getStashSourceFile(
          project,
          'src/components/Performers/PerformerCard.tsx',
        ),
        ctx,
      );
      const infos = builder.componentInfos;
      console.log(infos);
    });

    it('should infer React.FC<React.FC<{ urls: string[] | undefined }> types', () => {
      builder.process(
        getStashSourceFile(
          project,
          'src/components/Settings/SettingsPluginsPanel.tsx',
        ),
        ctx,
      );
      const infos = builder.componentInfos;
      console.log(infos);
    });
  });
});
