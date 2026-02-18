import type {
  ConnectionDetails,
  DatabaseKind,
} from "../../../shared/contracts";
import { BigQueryAdapter } from "./bigquery-adapter";
import { MySQLAdapter } from "./mysql-adapter";
import { PostgresAdapter } from "./postgres-adapter";
import { SQLiteAdapter } from "./sqlite-adapter";
import type { DatabaseAdapter } from "./types";

export class AdapterRegistry {
  private readonly adapters = new Map<DatabaseKind, DatabaseAdapter>();

  constructor() {
    this.register(new MySQLAdapter());
    this.register(new PostgresAdapter());
    this.register(new SQLiteAdapter());
    this.register(new BigQueryAdapter());
  }

  register(adapter: DatabaseAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  getByKind(kind: DatabaseKind): DatabaseAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`database adapter '${kind}' is not registered`);
    }
    return adapter;
  }

  getByConnection(details: ConnectionDetails): DatabaseAdapter {
    return this.getByKind(details.kind);
  }
}
