declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string, options?: unknown);
    pragma(source: string): unknown;
    exec(source: string): Database;
    prepare(source: string): {
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
    };
  }

  namespace Database {
    export type Database = InstanceType<typeof Database>;
  }

  export default Database;
}
