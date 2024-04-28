/**
 * Class to generate a Raw GQL value, which is then checked on the `findSafe` function on Model class.
 * Use this class only for generating enum strings
 */
export default class RawGQL {
    constructor(readonly value: string) {}
}