const findSafeGenerated = `import type { RawGQL } from '@neo4j/graphql-ogm';
export type RequiredResolvers = Required<Resolvers>;
export type Primitive = string | number | boolean;
export type Prettify<T> = {
    [K in keyof T]: T[K];
    } & {};
export type AddRawGQL<T> = NonNullable<T> extends (infer TItem)[] ? (TItem | RawGQL)[] : NonNullable<T> extends Primitive ? T : IsAny<NonNullable<T>> extends true ? T : {
    [key in keyof T]: AddRawGQL<T[key]> | RawGQL;
  }

export type AddRawGQLToOptions<TProps> = TProps extends { where?: infer TWhere } ? {
    where?: AddRawGQL<NonNullable<TWhere>>;
  } & AddRawGQLToOptions<Omit<TProps, 'where'>> : TProps extends { sort?: infer TSort } ? {
    sort?: NonNullable<TSort> extends (infer TItem)[] ? AddRawGQL<NonNullable<TItem>>[] : never;
  } : {};

  export type ResolverArgs<
  TModel extends object,
  TKey extends keyof TModel,
  TResolvers extends { [key: PropertyKey]: Resolver<any, any, any, any> },
> = TModel[TKey] extends Primitive
  ? never
  : NonNullable<TResolvers[TKey]> extends Resolver<any, any, any, infer Props>
  ? "directed" extends keyof Props
    ? Omit<Props, "directed" | "where" | "sort"> & { directed?: boolean } & AddRawGQLToOptions<Props>
    : {}
  : {};

export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;
type LastOf<T> = UnionToIntersection<
  T extends any ? () => T : never
> extends () => infer R
  ? R
  : never;

type Push<T extends any[], V> = [...T, V];

export type TuplifyUnion<
  T,
  L = LastOf<T>,
  N = [T] extends [never] ? true : false,
> = true extends N ? [] : Push<TuplifyUnion<Exclude<T, L>>, L>;

// This is pure magic
export type MagicArray<TArray extends any[]> =
  NonNullable<TArray> extends (infer TItem)[] ? TItem[] : never;
export type MagicObject<TElement> =
  NonNullable<TElement> extends (infer TItem)[]
    ? TItem[]
    : NonNullable<TElement> extends Primitive
    ? TElement
    : {
        [key in keyof TElement as TElement[key] extends never
          ? never
          : key]: MagicObject<TElement[key]>;
      };

export type StripNeverKeys<TElement> = TElement extends object
  ? {
      [key in keyof TElement as [TElement[key]] extends [never]
        ? never
        : TElement[key] extends never[]
        ? never
        : key]: TElement[key];
    }
  : TElement;

export type ClearObjectWithNeverKeys<
  TElement,
  TStripped = StripNeverKeys<TElement>,
> = [keyof Omit<TElement, keyof TStripped>] extends [never] ? TStripped : never;

export type StripNeverKeysAddTypename<
  TElement,
  TKey,
  TStripped = ClearObjectWithNeverKeys<TElement>,
> = [keyof TStripped] extends [never]
  ? never
  : TStripped & { __typename: TKey };

type RetrieveType<TItem> = Exclude<
  TItem,
  Promise<any>
> extends ResolverTypeWrapper<infer TValue>
  ? TValue extends { __typename?: infer TName }
    ? TItem extends object
      ? TName extends keyof Resolvers
        ? "__isTypeOf" extends keyof RequiredResolvers[TName]
          ? Omit<RequiredResolvers[TName], "__isTypeOf"> extends {
              [key: string]: Resolver<any, any, any, any>;
            }
            ? {
                Model: Exclude<TItem, Promise<any>>;
                Resolvers: Omit<RequiredResolvers[TName], "__isTypeOf">;
              }
            : never
          : never
        : never
      : never
    : never
  : never;

export type ResolverReturnType<
  TModel extends object,
  TKey extends keyof TModel,
  TResolvers extends { [key: PropertyKey]: Resolver<any, any, any, any> },
> = TModel[TKey] extends Primitive
  ? never
  : NonNullable<TResolvers[TKey]> extends Resolver<infer Props, any, any, any>
  ? Props extends (infer TItem)[]
    ? RetrieveType<Exclude<TItem, Promise<any>>>
    : RetrieveType<Exclude<Props, Promise<any>>>
  : never;

export type ResolverObject = {
  [key: PropertyKey]: Resolver<any, any, any> | Resolver<any, any, any, any>;
};

export type ResolveKey<
  TModel extends object,
  TResolvers extends ResolverObject,
  TItem,
  TKey,
  TOmittedElement = TKey extends keyof TItem
    ? Omit<NonNullable<TItem[TKey]>, "where" | "directed" | "options" | "after" | "first" | 'sort'>
    : never,
> = TKey extends keyof TModel
  ? NonNullable<TModel[TKey]> extends Primitive
    ? TModel[TKey]
    : ResolverReturnType<TModel, TKey, TResolvers> extends {
        Model: infer NestedTModel;
        Resolvers: infer NestedResolvers;
      }
    ? NestedTModel extends object
      ? NestedResolvers extends ResolverObject
        ? TKey extends keyof TItem
          ? "on" extends keyof TOmittedElement
            ? {
                -readonly [key in keyof TOmittedElement["on"]]: StripNeverKeysAddTypename<
                  {
                    -readonly [K in keyof TOmittedElement["on"][key]]: K extends keyof NestedTModel
                      ? NestedTModel[K] extends any[]
                        ? MagicArray<
                            ResolveKey<
                              NestedTModel,
                              NestedResolvers,
                              TOmittedElement["on"][key],
                              K
                            >[]
                          >
                        : ResolveKey<
                            NestedTModel,
                            NestedResolvers,
                            TOmittedElement["on"][key],
                            K
                          >
                      : never;
                  },
                  key
                >;
              }[keyof TOmittedElement["on"]] &
                ResolveKey<
                  TModel,
                  TResolvers,
                  Omit<TItem, TKey> & {
                    [key in TKey]: Omit<TOmittedElement, "on">;
                  },
                  TKey
                > | (undefined extends TModel[TKey]
                  ? NonNullable<TModel[TKey]> extends any[]
                  ? never
                  : undefined
                  : never)
              | (undefined extends TItem[TKey]
                ? NonNullable<TModel[TKey]> extends any[]
                ? never
                : undefined
                : never)
            : ClearObjectWithNeverKeys<{
                -readonly [key in keyof TOmittedElement as key extends keyof NestedTModel
                  ? key
                  : never]: key extends keyof NestedTModel
                  ? NestedTModel[key] extends any[]
                    ? MagicArray<
                        ResolveKey<
                          NestedTModel,
                          NestedResolvers,
                          TOmittedElement,
                          key
                        >[]
                      >
                    : ResolveKey<
                        NestedTModel,
                        NestedResolvers,
                        TOmittedElement,
                        key
                      >
                  : never;
              } | (undefined extends TModel[TKey]
                ? NonNullable<TModel[TKey]> extends any[]
                ? never
                : undefined
                : never)
            | (undefined extends TItem[TKey]
              ? NonNullable<TModel[TKey]> extends any[]
              ? never
              : undefined
              : never)>
          : never
        : never
      : TModel[TKey] extends (infer TArrayItem)[]
      ? NonNullable<TArrayItem> extends Primitive
        ? TArrayItem
        : never
      : never
    : never
  : never;

//Only if TValue = any, this is true
export type IsAny<TValue> = unknown extends TValue ? true : false;

export type NestedBooleanObject<
  TModel extends object,
  TResolvers extends ResolverObject,
  TKey extends keyof TModel,
  TElement,
  RequiredValue extends NonNullable<TElement> = NonNullable<TElement>,
> = IsAny<RequiredValue> extends true
  ? boolean
  : RequiredValue extends object
  ? RequiredValue extends (infer TItem)[]
    ? NonNullable<TItem> extends Primitive
      ? boolean
      : {
          [key in keyof TItem]?: ResolverReturnType<
            TModel,
            TKey,
            TResolvers
          > extends {
            Model: infer NestedModel;
            Resolvers: infer NestedResolvers;
          }
            ? NestedModel extends object
              ? NestedResolvers extends ResolverObject
                ? key extends keyof NestedModel
                  ? NonNullable<TItem[key]> extends object
                    ? NonNullable<TItem[key]> extends any[]
                      ? NestedBooleanObject<
                          NestedModel,
                          NestedResolvers,
                          key,
                          NonNullable<NonNullable<TItem>[key]>
                        >
                      : IsAny<NonNullable<TItem[key]>> extends true
                      ? boolean
                      : "__typename" extends keyof NonNullable<TItem[key]>
                      ? NestedBooleanObject<
                          NestedModel,
                          NestedResolvers,
                          key,
                          UnionToIntersection<
                            Omit<NonNullable<NonNullable<TItem>[key]>, "__typename">
                          > & {
                            __typename: NonNullable<
                              NonNullable<TItem[key]>["__typename"]
                            >;
                          }
                        >
                      : never
                    : boolean
                  : never
                : never
              : never
            : never;
        } & ResolverArgs<TModel, TKey, TResolvers> &
          BooleanOn<TElement>
    : {
        [key in keyof RequiredValue]?: ResolverReturnType<
          TModel,
          TKey,
          TResolvers
        > extends { Model: infer NestedModel; Resolvers: infer NestedResolvers }
          ? NestedModel extends object
            ? NestedResolvers extends ResolverObject
              ? key extends keyof NestedModel
                ? NonNullable<RequiredValue[key]> extends any[]
                  ? NestedBooleanObject<
                      NestedModel,
                      NestedResolvers,
                      key,
                      NonNullable<RequiredValue[key]>
                    >
                  : NonNullable<RequiredValue[key]> extends object
                  ? IsAny<NonNullable<RequiredValue[key]>> extends true
                    ? boolean
                    : "__typename" extends keyof NonNullable<RequiredValue[key]>
                    ? NestedBooleanObject<
                        NestedModel,
                        NestedResolvers,
                        key,
                        UnionToIntersection<
                          Omit<NonNullable<RequiredValue[key]>, "__typename">
                        > & {
                          __typename: NonNullable<
                            NonNullable<RequiredValue[key]>["__typename"]
                          >;
                        }
                      >
                    : never
                  : boolean
                : never
              : never
            : never
          : never;
      } & BooleanOn<TElement> &
        ResolverArgs<TModel, TKey, TResolvers>
  : boolean;

export type SelectionSetObject<
  TModel extends object,
  TResolvers extends ResolverObject,
> = {
  [key in keyof TModel]?: NonNullable<TModel[key]> extends Primitive
    ? boolean
    : NonNullable<TModel[key]> extends (infer TItem)[]
    ? "__typename" extends keyof TItem
      ? NestedBooleanObject<
          TModel,
          TResolvers,
          key,
          Prettify<
            UnionToIntersection<Omit<NonNullable<TItem>, "__typename">> & {
              __typename: NonNullable<NonNullable<TItem>["__typename"]>;
            }
          >
        >
      : NonNullable<TItem> extends Primitive
      ? boolean
      : never
    : "__typename" extends keyof NonNullable<TModel[key]>
    ? NestedBooleanObject<
        TModel,
        TResolvers,
        key,
        Prettify<
          UnionToIntersection<Omit<NonNullable<TModel[key]>, "__typename">> & {
            __typename: NonNullable<NonNullable<TModel[key]>["__typename"]>;
          }
        >
      >
    : never;
};

type BooleanOn<TElement> = TElement extends { __typename: infer Typename }
  ? TuplifyUnion<NonNullable<Typename>>["length"] extends 1
    ? {}
    : NonNullable<Typename> extends string
    ? {
        on?: {
          [key in NonNullable<Typename>]?: key extends keyof RequiredResolvers
            ? key extends keyof ResolversTypes
              ? Omit<
                  RequiredResolvers[key],
                  "__isTypeOf"
                > extends ResolverObject
                ? {
                    [K in keyof NonNullable<
                      Exclude<ResolversTypes[key], Promise<any>>
                    >]?: NestedBooleanObject<
                      NonNullable<Exclude<ResolversTypes[key], Promise<any>>>,
                      Omit<RequiredResolvers[key], "__isTypeOf">,
                      K,
                      NonNullable<Exclude<ResolversTypes[key], Promise<any>>>[K]
                    >;
                  }
                : never
              : never
            : never;
        };
      }
    : never
  : {};

export type InferFromSelectionSetObject<
  TModel extends object,
  TResolvers extends ResolverObject,
  TSelectionSet extends SelectionSetObject<TModel, TResolvers>,
> = MagicObject<{
  -readonly [key in keyof TSelectionSet]: key extends keyof TModel
  ? NonNullable<TModel[key]> extends any[] ? ResolveKey<TModel, TResolvers, TSelectionSet, key>[]  | (undefined extends TModel[key] ? undefined : never) : ResolveKey<TModel, TResolvers, TSelectionSet, key> | (undefined extends TModel[key] ? undefined : never)
  : never;
}>`

export default findSafeGenerated;