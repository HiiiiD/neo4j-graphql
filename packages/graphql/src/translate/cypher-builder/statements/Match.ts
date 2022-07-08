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

import type { CypherContext } from "../CypherContext";
import type { MatchableElement, MatchParams } from "../MatchPattern";
import { MatchPattern } from "../MatchPattern";
import type { Node } from "../references/Node";
import { Query } from "./Query";
import { ReturnStatement } from "./Return";
import { WhereInput, WhereStatement } from "./Where";

export class Match<T extends MatchableElement> extends Query {
    private matchPattern: MatchPattern<T>;
    private whereStatement: WhereStatement | undefined;

    constructor(variable: T, parameters: MatchParams<T> = {}, parent?: Query) {
        super(parent);
        this.matchPattern = new MatchPattern(variable).withParams(parameters);
    }

    public where(...input: WhereInput): this {
        if (!this.whereStatement) {
            const whereStatement = new WhereStatement(this, input);
            this.addStatement(whereStatement);
            this.whereStatement = whereStatement;
        } else {
            // Avoids adding unneeded where statements
            this.whereStatement.addWhereParams(input);
        }
        return this;
    }

    public cypher(context: CypherContext, childrenCypher: string): string {
        const nodeCypher = this.matchPattern.getCypher(context);
        return `MATCH ${nodeCypher}\n${childrenCypher}`;
    }

    public return(node: Node, fields?: string[], alias?: string): this {
        const returnStatement = new ReturnStatement(this, [node, fields, alias]);
        this.addStatement(returnStatement);
        return this;
    }
}
