import { describe, it } from 'vitest';
import { testContext } from '../test/utils';
import { StashTypesBuilder } from './stash-types';

describe('stash-types', () => {
  const ctx = testContext();
  let builder: StashTypesBuilder;

  beforeAll(() => {
    builder = new StashTypesBuilder();
  });
  it("should extract the 'stash-types' names", () => {
    builder.write(ctx);
  });
});
