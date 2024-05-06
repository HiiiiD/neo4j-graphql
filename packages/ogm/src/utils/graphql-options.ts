import RawGQL from "../classes/RawGQL";

export const buildGQLOptions = (obj: any[] | RawGQL | string | Record<string, any>, addCurlyBraces = false) => {
    if (Array.isArray(obj)) {
        const isObjectArray = obj.some(o => typeof o === 'object');
        if (!isObjectArray) return `[${obj.map(o => buildGQLOptions(o))}]`;
        return `[${obj.map(o => buildGQLOptions(o, true))}]`;
    }
    if (typeof obj !== 'object') {
        if (typeof obj === 'string') {
            return `"${obj}"`;
        }
        return obj;
    }
    if (obj instanceof RawGQL) {
        return obj.value;
    }
    const value = Object.entries(obj)
        .filter(([_, value]) => typeof value !== "undefined")
        .map(([key, value]) => `${key}:${buildGQLOptions(value, true)}`)
        .join(',');
    return addCurlyBraces ? `{${value}}` : value;
}