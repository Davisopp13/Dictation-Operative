/** D1 batch is atomic: the current Worker opens the write gate only inside its
 * own transaction, then closes it. Earlier invocations cannot write between
 * those statements, even after the current deployment has reopened traffic. */
const adapters = new WeakMap<D1Database, D1Database>();
export function releaseDatabase(db: D1Database): D1Database {
  const existing = adapters.get(db);
  if (existing) return existing;
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrapDatabase = (database: Pick<D1Database, 'prepare' | 'batch'>) => {
    const batch = async <T = unknown>(
      wrapped: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> => {
      const raw = wrapped.map((statement) => {
        const value = statements.get(statement);
        if (!value) throw new Error('Statement belongs to another database.');
        return value;
      });
      const results = await database.batch<T>([
        database.prepare(
          "UPDATE p3_release_maintenance SET active=0 WHERE id=1 AND mode='open'",
        ),
        ...raw,
        database.prepare(
          'UPDATE p3_release_maintenance SET active=1 WHERE id=1',
        ),
      ]);
      return results.slice(1, -1);
    };
    const prepare = (sql: string): D1PreparedStatement => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
        const readOnly = /^\s*SELECT\b/i.test(sql);
        const all = async <T = Record<string, unknown>>(): Promise<
          D1Result<T>
        > => (readOnly ? statement.all<T>() : (await batch<T>([proxy]))[0]);
        async function first<T = Record<string, unknown>>(
          column?: string,
        ): Promise<T | null> {
          const row = (await all<Record<string, unknown>>()).results[0];
          if (!row) return null;
          if (column !== undefined && !(column in row))
            throw new Error('D1 column not found.');
          return (column === undefined ? row : row[column]) as T;
        }
        function raw<T = unknown[]>(options: {
          columnNames: true;
        }): Promise<[string[], ...T[]]>;
        function raw<T = unknown[]>(options?: {
          columnNames?: false;
        }): Promise<T[]>;
        async function raw<T = unknown[]>(options?: {
          columnNames?: boolean;
        }): Promise<T[] | [string[], ...T[]]> {
          if (readOnly)
            return options?.columnNames
              ? statement.raw<T>({ columnNames: true })
              : statement.raw<T>();
          // Current Drizzle mutations use named RETURNING fields without duplicate
          // or numeric aliases. SELECT keeps native D1 column/row encoding.
          if (options?.columnNames)
            throw new Error(
              'Write column metadata is unsupported by the release fence.',
            );
          return (await all<Record<string, unknown>>()).results.map(
            (row) => Object.values(row) as T,
          );
        }
        const proxy: D1PreparedStatement = {
          bind: (...values) => wrap(statement.bind(...values)),
          all,
          run: all,
          first,
          raw,
        };
        statements.set(proxy, statement);
        return proxy;
      };
      return wrap(database.prepare(sql));
    };
    return { prepare, batch };
  };
  const adapter: D1Database = {
    ...wrapDatabase(db),
    withSession: (constraint) => {
      const session = db.withSession(constraint);
      return {
        ...wrapDatabase(session),
        getBookmark: () => session.getBookmark(),
      };
    },
    exec: () => {
      throw new Error('Use prepared statements inside the release fence.');
    },
    // Required by the D1 interface; intentionally rejected, never delegated.
    // oxlint-disable-next-line typescript/no-deprecated
    dump: () => {
      throw new Error('Database dumps are not an application operation.');
    },
  };
  adapters.set(db, adapter);
  return adapter;
}
export function releaseEnvironment<
  T extends { DB: D1Database; WORKSPACE_WRITE_FENCE?: string },
>(env: T): T {
  return env.WORKSPACE_WRITE_FENCE === 'on'
    ? { ...env, DB: releaseDatabase(env.DB) }
    : env;
}
