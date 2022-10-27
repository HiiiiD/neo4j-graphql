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

import { gql } from "apollo-server";
import type { DocumentNode } from "graphql";
import { Neo4jGraphQL } from "../../../src";
import { formatCypher, translateQuery, formatParams } from "../utils/tck-test-utils";

describe("https://github.com/neo4j/graphql/issues/2262", () => {
    let typeDefs: DocumentNode;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = gql`
            type Component {
                uuid: String
                upstreamProcess: Process @relationship(type: "OUTPUT", direction: IN)
                downstreamProcesses: [Process!]! @relationship(type: "INPUT", direction: OUT)
            }

            type Process {
                uuid: String
                componentOutputs: [Component!]! @relationship(type: "OUTPUT", direction: OUT)
                componentInputs: [Component!]! @relationship(type: "INPUT", direction: IN)
            }
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
        });
    });

    test("query nested relations under a root connection field", async () => {
        const query = gql`
            query ComponentsProcesses {
                components(where: { uuid: "c1" }) {
                    uuid
                    upstreamProcessConnection {
                        edges {
                            node {
                                uuid
                                componentInputsConnection(sort: [{ node: { uuid: DESC } }]) {
                                    edges {
                                        node {
                                            uuid
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;
        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`Component\`)
            WHERE this.uuid = $param0
            CALL {
                WITH this
                MATCH (this)<-[this_connection_upstreamProcessConnectionthis0:OUTPUT]-(this_Process:\`Process\`)
                CALL {
                    WITH this_Process
                    MATCH (this_Process)<-[this_Process_connection_componentInputsConnectionthis0:INPUT]-(this_Process_Component:\`Component\`)
                    WITH this_Process_connection_componentInputsConnectionthis0, this_Process_Component
                    ORDER BY this_Process_Component.uuid DESC
                    WITH { node: { uuid: this_Process_Component.uuid } } AS edge
                    WITH collect(edge) AS edges
                    WITH edges, size(edges) AS totalCount
                    CALL {
                        WITH edges
                        UNWIND edges AS edge
                        WITH edge
                        ORDER BY edge.node.uuid DESC
                        RETURN collect(edge) AS this_Process_connection_componentInputsConnectionvar1
                    }
                    WITH this_Process_connection_componentInputsConnectionvar1 AS edges, totalCount
                    RETURN { edges: edges, totalCount: totalCount } AS this_Process_componentInputsConnection
                }
                WITH { node: { uuid: this_Process.uuid, componentInputsConnection: this_Process_componentInputsConnection } } AS edge
                WITH collect(edge) AS edges
                WITH edges, size(edges) AS totalCount
                RETURN { edges: edges, totalCount: totalCount } AS this_upstreamProcessConnection
            }
            RETURN this { .uuid, upstreamProcessConnection: this_upstreamProcessConnection } AS this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"c1\\"
            }"
        `);
    });
});