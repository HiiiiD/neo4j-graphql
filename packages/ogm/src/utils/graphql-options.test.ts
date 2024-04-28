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

import RawGQL from "../classes/RawGQL";
import { buildGQLOptions } from "./graphql-options";

describe("graphql options", () => {
    test("RawGQL should be mapped as a plain string without quotes", () => {
        const result = buildGQLOptions(new RawGQL('ASC'));

        expect(result).toBe("ASC");
    });
    test("Plain string should be quoted", () => {
        const result = buildGQLOptions('ASC');

        expect(result).toBe(`"ASC"`);
    });
    test("Build a simple where query", () => {
        const result = buildGQLOptions({ where: { _id_GT: 1 } })

        expect(result).toBe("{where:{_id_GT:1}}");
    });
    test("Build a more complex filter", () => {
        const result = buildGQLOptions({ where: { _id_GT: 1, query: "TEST" }, sortBy: { title: new RawGQL('ASC') } })

        expect(result).toBe(`{where:{_id_GT:1,query:"TEST"},sortBy:{title:ASC}}`);
    });
    test("Object arrays", () => {
        const result = buildGQLOptions({ sortBy: [{ title: new RawGQL('ASC') }] })

        expect(result).toBe(`{sortBy:[{title:ASC}]}`);
    });
    test("Primitive arrays", () => {
        const result = buildGQLOptions({ where: { category_IN: ['CAT1','CAT2','CAT3'] } })

        expect(result).toBe(`{where:{category_IN:["CAT1","CAT2","CAT3"]}}`);
    });
});
