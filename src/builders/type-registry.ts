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
    if (!this.types[typeDef.name]) {
      this.types[typeDef.name] = typeDef.props;
    }
    const visit = (def: SerializedType) => {
      if (isObjectType(def)) {
        this.addType(def);
      } else if (isFunctionType(def) && isObjectType(def.returnType)) {
        this.addType(def.returnType);
      } else if (isImportRefObjectType(def)) {
        Object.values(def.props).forEach(visit);
      } else if (isMappedType(def)) {
        Object.values(def.typeArguments).forEach(visit);
      }
    };

    Object.keys(typeDef.props).forEach((prop) => {
      visit(typeDef.props[prop]);
    });
  }

  public getTypes(): Record<string, Record<string, SerializedType>> {
    return this.types;
  }
}
