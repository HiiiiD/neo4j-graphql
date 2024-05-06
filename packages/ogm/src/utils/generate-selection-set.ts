import { buildGQLOptions } from "./graphql-options";

export default function generateSelectionSet(selectionSet: Record<string, any>) {
    return Object.entries(selectionSet)
    .map(([k, v]) => {
        if (v === true) return k;
        const valueKeys = Object.keys(v);
        if (["where", "directed", "options", "after", "first", "sort"].some((v) => valueKeys.includes(v))) {
            const options = Object.entries(v)
                .filter(([k]) => ["where", "directed", "options", "after", "first", "sort"].includes(k))
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
            const { where: w, directed: d, options: o, after: a, first: f, sort: s, ...other } = v;
            return `${k} (${buildGQLOptions(options)}) {\n${generateSelectionSet(other)}\n}`;
        }

        if (valueKeys.includes("on")) {
            const entries = Object.entries(v["on"])
                .map(([modelName, value]) => {
                    return `... on ${modelName} {\n${generateSelectionSet(value as Record<string, any>)}\n}`;
                })
                .join("\n");
            const { on, ...other } = v;
            return `${k} {\n${generateSelectionSet(other)}\n${entries}\n}`;
        }

        return `${k} {\n${generateSelectionSet(v)}\n}`;
    })
    .join("\n");
}