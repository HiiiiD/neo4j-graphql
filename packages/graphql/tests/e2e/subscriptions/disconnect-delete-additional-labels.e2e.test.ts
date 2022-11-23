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

import type { Driver } from "neo4j-driver";
import supertest from "supertest";
import { Neo4jGraphQL } from "../../../src/classes";
import { generateUniqueType, UniqueType } from "../../utils/graphql-types";
import type { TestGraphQLServer } from "../setup/apollo-server";
import { ApolloTestServer } from "../setup/apollo-server";
import { TestSubscriptionsPlugin } from "../../utils/TestSubscriptionPlugin";
import { WebSocketTestClient } from "../setup/ws-client";
import Neo4j from "../setup/neo4j";
import { cleanNodes } from "../../utils/clean-nodes";
import { delay } from "../../../src/utils/utils";

describe("Delete Subscriptions when only nodes are targeted - with interfaces, unions and label manipulation", () => {
    let neo4j: Neo4j;
    let driver: Driver;
    let server: TestGraphQLServer;
    let wsClient: WebSocketTestClient;
    let wsClient2: WebSocketTestClient;
    let typeMovie: UniqueType;
    let typeActor: UniqueType;
    let typePerson: UniqueType;
    let typeDinosaur: UniqueType;
    let typeFilm: UniqueType;
    let typeSeries: UniqueType;
    let typeProduction: UniqueType;
    let typeDefs: string;

    // TODO: add tests for specifying @node label + additional labels!

    beforeEach(async () => {
        typeActor = generateUniqueType("Actor");
        typePerson = generateUniqueType("Person");
        typeDinosaur = generateUniqueType("Dinosaur");
        typeMovie = generateUniqueType("Movie");
        typeFilm = generateUniqueType("Film");
        typeSeries = generateUniqueType("Series");
        typeProduction = generateUniqueType("Production");

        typeDefs = `
             type ${typeActor} @node(additionalLabels: ["${typePerson}"]) {
                 name: String
                 movies: [${typeMovie}!]! @relationship(type: "ACTED_IN", direction: OUT)
             }

            type ${typeDinosaur} @node(label: "${typePerson}") {
                name: String
                movies: [${typeMovie}!]! @relationship(type: "ACTED_IN", direction: OUT)
            }

            type ${typePerson} {
                name: String
                movies: [${typeMovie}!]! @relationship(type: "ACTED_IN", direction: OUT)
            }

            type ${typeMovie} @node(label: "${typeFilm}", additionalLabels: ["Multimedia"]) {
                id: ID
                title: String
                actors: [${typeActor}!]! @relationship(type: "ACTED_IN", direction: IN)
                directors: [${typePerson}!]! @relationship(type: "DIRECTED", direction: IN)
            }

             type ${typeSeries} @node(additionalLabels: ["${typeProduction}"]) {
                 title: String
             }

             type ${typeProduction} @node(additionalLabels: ["${typeSeries}"]) {
                 title: String
             }
        `;

        neo4j = new Neo4j();
        driver = await neo4j.getDriver();

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            driver,
            config: {
                driverConfig: {
                    database: neo4j.getIntegrationDatabaseName(),
                },
            },
            plugins: {
                subscriptions: new TestSubscriptionsPlugin(),
            },
        });
        server = new ApolloTestServer(neoSchema);
        await server.start();

        wsClient = new WebSocketTestClient(server.wsPath);
        wsClient2 = new WebSocketTestClient(server.wsPath);
    });

    afterEach(async () => {
        await wsClient.close();
        await wsClient2.close();

        const session = driver.session();
        await cleanNodes(session, [typeActor, typeMovie, typePerson, typeFilm, typeSeries, typeProduction]);

        await server.close();
        await driver.close();
    });

    const actorSubscriptionQuery = (typeActor) => `
        subscription SubscriptionActor {
            ${typeActor.operations.subscribe.disconnected} {
                relationshipFieldName
                event
                ${typeActor.operations.subscribe.payload.disconnected} {
                    name
                }
                deletedRelationship {
                    movies {
                        node {
                            title
                        }
                    }
                }
            }
        }
    `;

    const movieSubscriptionQuery = (typeMovie) => `
subscription SubscriptionMovie {
    ${typeMovie.operations.subscribe.disconnected} {
        relationshipFieldName
        event
        ${typeMovie.operations.subscribe.payload.disconnected} {
            title
        }
        deletedRelationship {
            actors {
                node {
                    name
                }
            }
        }
    }
}
`;

    const personSubscriptionQuery = (typePerson) => `
subscription SubscriptionPerson {
    ${typePerson.operations.subscribe.disconnected} {
        relationshipFieldName
        event
        ${typePerson.operations.subscribe.payload.disconnected} {
            name
        }
        deletedRelationship {
            movies {
                node {
                    title
                }
            }
        }
    }
}
`;

    // ==============================================================

    test("disconnect via delete - standard type - single relationship - 2 matching nodes", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
            mutation {
                ${typeActor.operations.create}(
                    input: [
                        {
                            movies: {
                                create: [
                                    {
                                        node: {
                                            title: "John Wick"
                                        }
                                    },
                                    {
                                        node: {
                                            title: "Constantine"
                                        }
                                    }
                                ]
                            },
                            name: "Keanu Reeves",
                        },
                        {
                            name: "Keanu Reeves",
                        }
                    ]
                ) {
                    ${typeActor.plural} {
                        name
                    }
                }
            }
        `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery(typeMovie));

        await wsClient.subscribe(actorSubscriptionQuery(typeActor));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeActor.operations.delete}(
                            where: {
                                name: "Keanu Reeves"
                            }
                    ) {
                        nodesDeleted
                        relationshipsDeleted
                    }
                }
            `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(1);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });

    test("1disconnect via delete - standard type - single relationship - 2 matching nodes", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
            mutation {
                ${typeMovie.operations.create}(
                    input: [
                        {
                            actors: {
                                create: [
                                    {
                                        node: {
                                            name: "Someone"
                                        }
                                    },
                                    {
                                        node: {
                                            name: "Someone else"
                                        }
                                    }
                                ]
                            },
                            title: "Constantine 3",
                        },
                        {
                            actors: {
                                create: [
                                    {
                                        node: {
                                            name: "Someone"
                                        }
                                    }
                                ]
                            },
                            title: "Constantine 2",
                        }
                    ]
                ) {
                    ${typeMovie.plural} {
                        title
                    }
                }
            }
        `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery(typeMovie));

        await wsClient.subscribe(actorSubscriptionQuery(typeActor));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.delete}(
                            where: {
                                title_STARTS_WITH: "Constantine"
                            }
                    ) {
                        nodesDeleted
                        relationshipsDeleted
                    }
                }
            `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(1);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });

    test.only("2disconnect via delete - standard type - single relationship - 2 matching nodes", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
        mutation {
            ${typePerson.operations.create}(
                input: [
                    {
                        name: "Person someone",
                    }
                ]
            ) {
                ${typePerson.plural} {
                    name
                }
            }
        }
    `,
            })
            .expect(200);

        await supertest(server.path)
            .post("")
            .send({
                query: `
        mutation {
            ${typeDinosaur.operations.create}(
                input: [
                    {
                        name: "Dinosaur someone",
                    }
                ]
            ) {
                ${typeDinosaur.plural} {
                    name
                }
            }
        }
    `,
            })
            .expect(200);

        await supertest(server.path)
            .post("")
            .send({
                query: `
            mutation {
                ${typeMovie.operations.create}(
                    input: [
                        {
                            directors: {
                                connect: [
                                    {
                                       where: {
                                            node: {
                                                name: "Person someone"
                                            }
                                        }
                                    },
                                    {
                                        where: {
                                             node: {
                                                 name: "Dinosaur someone"
                                             }
                                         }
                                     }
                                ]
                            },
                            title: "Constantine 3",
                        },
                        {
                            directors: {
                                create: [
                                    {
                                        node: {
                                            name: "Dinosaur or Person"
                                        }
                                    }
                                ]
                            },
                            title: "Constantine 2",
                        }
                    ]
                ) {
                    ${typeMovie.plural} {
                        title
                    }
                }
            }
        `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery(typeMovie));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.delete}(
                            where: {
                                title_STARTS_WITH: "Constantine"
                            }
                    ) {
                        nodesDeleted
                        relationshipsDeleted
                    }
                }
            `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(3);
        expect(wsClient.events).toHaveLength(3);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "Constantine 3" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        directors: {
                            node: {
                                name: "Person someone",
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "Constantine 3" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        directors: {
                            node: {
                                name: "Dinosaur someone",
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "Constantine 2" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        directors: {
                            node: {
                                name: "Dinosaur or Person",
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Person someone 3",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            node: {
                                title: "Constantine",
                            },
                        },
                    },
                },
            },
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Dinosaur someone 3",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            node: {
                                title: "Constantine",
                            },
                        },
                    },
                },
            },
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Dinosaur or Person 2",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            node: {
                                title: "Constantine",
                            },
                        },
                    },
                },
            },
        ]);
    });

    // Dinosaur & Person
    // Series, Productions

    // ==============================================================

    /*
    test("disconnect via delete - standard type - single relationship - 2 matching nodes", async () => {  
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                actors: {
                                create: [
                                    {
                                    node: {
                                        name: "Keanu Reeves"
                                    },
                                    edge: {
                                        screenTime: 42
                                    }
                                    }
                                ]
                                },
                                title: "John Wick",
                            },
                            {
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(actorSubscriptionQuery(typeActor));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(1);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });

    test("disconnect via delete - standard type - single relationship", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                actors: {
                                create: [
                                    {
                                    node: {
                                        name: "Keanu Reeves"
                                    },
                                    edge: {
                                        screenTime: 42
                                    }
                                    }
                                ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(actorSubscriptionQuery(typeActor));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(1);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });

    test("disconnect via delete nested - standard type - double relationship", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                actors: {
                                    create: [
                                        {
                                            node: {
                                                name: "Keanu Reeves"
                                            },
                                            edge: {
                                                screenTime: 42
                                            }
                                        },
                                        {
                                            node: {
                                                name: "Keanu Reeves"
                                            },
                                            edge: {
                                                screenTime: 42
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(actorSubscriptionQuery(typeActor));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(2);
        expect(wsClient.events).toHaveLength(2);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
            {
                [typeActor.operations.subscribe.disconnected]: {
                    [typeActor.operations.subscribe.payload.disconnected]: {
                        name: "Keanu Reeves",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            screenTime: 42,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    test("disconnect via delete - union type - single relationship single type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    }
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(2);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(1);
        expect(wsClient.events).toHaveLength(0);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
        ]);
    });
    test("disconnect via delete - union type - single relationship per type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    },
                                    ${typePerson.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Jim",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            }
                                        ]
                                    }   
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(2);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(2);
        expect(wsClient.events).toHaveLength(0);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jim",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
        ]);
    });
    test("disconnect via delete - union type - single one, double other relationships", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    },
                                    ${typePerson.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Jim",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            }
                                        ]
                                    }   
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(2);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(3);
        expect(wsClient.events).toHaveLength(0);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jim",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
        ]);
    });
    test("disconnect via delete - union type - double relationships per type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    },
                                    ${typePerson.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Jim",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Jill",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            }
                                        ]
                                    }   
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(2);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(4);
        expect(wsClient.events).toHaveLength(0);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jim",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jill",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
        ]);
    });
    test("disconnect via delete nested - interface type - single relationship per type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                reviewers: {
                                    create: [
                                            {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(3);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(2);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    test("disconnect via delete nested - interface type - single one, double other relationships", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                reviewers: {
                                    create: [
                                            {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix2"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            },
                                                            {
                                                                node: {
                                                                    title: "Matrix3"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        },
                                        {
                                            node: {
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(3);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(3);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    test("disconnect via delete nested - interface type - double relationships per type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                reviewers: {
                                    create: [
                                            {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        },
                                        {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(3);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(4);
        expect(wsClient.events).toHaveLength(2);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    test("disconnect via delete nested - union type + interface type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves",
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix"
                                                                },
                                                                edge: {
                                                                    screenTime: 1000
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    },
                                    ${typePerson.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Jim",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix2"
                                                                },
                                                                edge: {
                                                                    score: 42
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Jill",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            }
                                        ]
                                    }   
                                },
                                reviewers: {
                                    create: [
                                            {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix2"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            },
                                                            {
                                                                node: {
                                                                    title: "Matrix3"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        },
                                        {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Julia",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Other Matrix"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            }
                                                        ]
                                                    }
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                } 
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(3);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(7);
        expect(wsClient.events).toHaveLength(2);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },

            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jim",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jill",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },

            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Julia",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Julia",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    test("disconnect via delete nested - standard type + union type + interface type", async () => {
        // 1. create
        await supertest(server.path)
            .post("")
            .send({
                query: `
                mutation {
                    ${typeMovie.operations.create}(
                        input: [
                            {
                                actors: {
                                    create: [
                                        {
                                        node: {
                                            name: "Keanu Reeves"
                                        },
                                        edge: {
                                            screenTime: 42
                                        }
                                        }
                                    ]
                                },
                                directors: {
                                    ${typeActor.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Keanu Reeves",
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix"
                                                                },
                                                                edge: {
                                                                    screenTime: 1000
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Keanu Reeves"
                                                },
                                                edge: {
                                                    year: 2019
                                                }
                                            }
                                        ]
                                    },
                                    ${typePerson.name}: {
                                        create: [
                                            {
                                                node: {
                                                    name: "Jim",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix2"
                                                                },
                                                                edge: {
                                                                    score: 42
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            },
                                            {
                                                node: {
                                                    name: "Jill",
                                                    reputation: 10
                                                },
                                                edge: {
                                                    year: 2020
                                                }
                                            }
                                        ]
                                    }   
                                },
                                reviewers: {
                                    create: [
                                            {
                                            node: {
                                                ${typePerson.name}: {
                                                    name: "Ana",
                                                    reputation: 10,
                                                    movies: {
                                                        create: [
                                                            {
                                                                node: {
                                                                    title: "Matrix2"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            },
                                                            {
                                                                node: {
                                                                    title: "Matrix3"
                                                                },
                                                                edge: {
                                                                    score: 420
                                                                }
                                                            }
                                                        ]
                                                    }
                                                },
                                                ${typeInfluencer.name}: {
                                                    url: "/bob",
                                                    reputation: 10
                                                }
                                            },
                                            edge: {
                                                score: 100
                                            }
                                        }
                                    ]
                                },
                                title: "John Wick",
                            }
                        ]
                    ) {
                        ${typeMovie.plural} {
                            title
                        }
                    }
                }
            `,
            })
            .expect(200);

        // 2. subscribe both ways
        await wsClient2.subscribe(movieSubscriptionQuery({ typeInfluencer, typeMovie, typePerson }));

        await wsClient.subscribe(personSubscriptionQuery(typePerson));

        // 3. perform update on created node
        await supertest(server.path)
            .post("")
            .send({
                query: `
                    mutation {
                        ${typeMovie.operations.delete}(
                                where: {
                                  title: "John Wick"
                                }
                        ) {
                            nodesDeleted
                            relationshipsDeleted
                        }
                    }
                `,
            })
            .expect(200);

        await delay(3);
        expect(wsClient.errors).toEqual([]);
        expect(wsClient2.errors).toEqual([]);

        expect(wsClient2.events).toHaveLength(7);
        expect(wsClient.events).toHaveLength(1);

        expect(wsClient2.events).toIncludeSameMembers([
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2019,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "actors",
                    deletedRelationship: {
                        actors: {
                            screenTime: 42,
                            node: {
                                name: "Keanu Reeves",
                            },
                        },
                        directors: null,
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jim",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "directors",
                    deletedRelationship: {
                        actors: null,
                        directors: {
                            year: 2020,
                            node: {
                                name: "Jill",
                                reputation: 10,
                            },
                        },
                        reviewers: null,
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                name: "Ana",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
            {
                [typeMovie.operations.subscribe.disconnected]: {
                    [typeMovie.operations.subscribe.payload.disconnected]: { title: "John Wick" },
                    event: "DISCONNECT",

                    relationshipFieldName: "reviewers",
                    deletedRelationship: {
                        actors: null,
                        directors: null,
                        reviewers: {
                            score: 100,
                            node: {
                                url: "/bob",
                                reputation: 10,
                            },
                        },
                    },
                },
            },
        ]);
        expect(wsClient.events).toIncludeSameMembers([
            {
                [typePerson.operations.subscribe.disconnected]: {
                    [typePerson.operations.subscribe.payload.disconnected]: {
                        name: "Ana",
                    },
                    event: "DISCONNECT",

                    relationshipFieldName: "movies",
                    deletedRelationship: {
                        movies: {
                            score: 100,
                            node: {
                                title: "John Wick",
                            },
                        },
                    },
                },
            },
        ]);
    });
    */
});
