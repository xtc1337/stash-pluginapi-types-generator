import {
  isFunctionType,
  isImportRefObjectType,
  isMappedType,
  isObjectType,
  ObjectType,
  SerializedType,
} from '../ast';

export class TypeRegistry {
  private types: Record<string, Record<string, SerializedType>> = {};

  public addType(typeDef: ObjectType): void {
    if (typeDef.name === 'ChangeButtonSetting') {
      console.log(typeDef.props);
    }
    if (!this.types[typeDef.name]) {
      this.types[typeDef.name] = {};
    }
    this.types[typeDef.name][typeDef.filePath] = typeDef;

    const visit = (def: SerializedType) => {
      if (isObjectType(def)) {
        this.addType(def);
      } else if (isFunctionType(def) && isObjectType(def.returnType)) {
        this.addType(def.returnType);
      } else if (isImportRefObjectType(def)) {
        Object.values(def.props).forEach(visit);
        def.types.forEach(visit);
      } else if (isMappedType(def)) {
        Object.values(def.typeArguments).forEach(visit);
      }
    };

    Object.keys(typeDef.props).forEach((prop) => {
      visit(typeDef.props[prop]);
    });
  }

  public getType(name: string, filePath: string): SerializedType | undefined {
    return this.types[name][filePath];
  }
}
