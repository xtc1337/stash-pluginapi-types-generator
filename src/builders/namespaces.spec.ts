import { describe, expect, it } from 'vitest';
import { Project, SourceFile } from 'ts-morph';
import { getStashSourceFile, getTestProject, testContext } from '../test/utils';
import { NamespaceBuilder } from './namespaces';

describe('namespaces', () => {
  let project: Project;
  const ctx = testContext();
  let sourceFile: SourceFile;

  beforeAll(() => {
    project = getTestProject();
    sourceFile = getStashSourceFile(project, 'src/pluginApi.tsx');
  });
  function forNs(ns: string, props: Record<string, string>) {
    const builder = new NamespaceBuilder([ns]);
    builder.process(sourceFile, ctx);
    builder.objectTypes.forEach((rootType) => {
      expect(rootType.name).toEqual(ns);
      Object.keys(props).forEach((prop) => {
        expect(rootType.props).toHaveProperty(prop);
        expect(rootType.props[prop]).toEqual({
          kind: 'importRef',
          name: `typeof import("${props[prop]}")`,
          importPath: props[prop],
        });
      });
    });
  }
  describe('libraries', () => {
    it('should extract the `libraries` names', () => {
      forNs('libraries', {
        ReactRouterDOM: 'react-router-dom',
        Bootstrap: 'react-bootstrap',
        Apollo: '@apollo/client',
        Intl: 'react-intl',
        FontAwesomeRegular: '@fortawesome/free-regular-svg-icons',
        FontAwesomeSolid: '@fortawesome/free-solid-svg-icons',
        FontAwesomeBrands: '@fortawesome/free-brands-svg-icons',
        Mousetrap: 'mousetrap',
        MousetrapPause: 'mousetrap-pause',
        ReactSelect: 'react-select',
      });
    });
  });
  describe('register', () => {
    it('should extract the `register` names', () => {
      forNs('register', {});
    });
  });
});
