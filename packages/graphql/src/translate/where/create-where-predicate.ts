/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { GraphQLWhereArg, Context } from "../../types";
import type { GraphElement } from "../../classes";
import * as CypherBuilder from "../cypher-builder/CypherBuilder";
// Recursive function
// eslint-disable-next-line import/no-cycle
import { createPropertyWhere } from "./property-operations/create-property-where";

type WhereOperators = "OR" | "AND";

function isWhereOperator(key: string): key is WhereOperators {
    return ["OR", "AND"].includes(key);
}

/** Translate a target node and GraphQL input into a Cypher operation o valid where expression */
export function createWherePredicate({
    targetElement,
    whereInput,
    context,
    element,
}: {
    targetElement: CypherBuilder.Variable;
    whereInput: GraphQLWhereArg;
    context: Context;
    element: GraphElement;
}): CypherBuilder.Predicate | undefined {
    const whereFields = Object.entries(whereInput);

    const predicates = whereFields.map(([key, value]): CypherBuilder.Predicate | undefined => {
        if (isWhereOperator(key)) {
            return createNestedPredicate({
                key,
                element,
                targetElement,
                context,
                value,
            });
        }

        return createPropertyWhere({ key, value, element, targetElement, context });
    });

    // Implicit AND
    return CypherBuilder.and(...predicates);
}

function createNestedPredicate({
    key,
    element,
    targetElement,
    context,
    value,
}: {
    key: WhereOperators;
    value: Array<GraphQLWhereArg>;
    element: GraphElement;
    targetElement: CypherBuilder.Variable;
    context: Context;
}): CypherBuilder.Predicate | undefined {
    const nested = value.map((v) => {
        return createWherePredicate({ whereInput: v, element, targetElement, context });
    });
    if (key === "OR") {
        return CypherBuilder.or(...nested);
    }
    return CypherBuilder.and(...nested);
}