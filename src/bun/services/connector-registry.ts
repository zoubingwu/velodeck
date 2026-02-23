import type {
  ConnectionProfile,
  ConnectorKind,
  ConnectorManifest,
} from "../../shared/contracts";
import { BigQueryConnector } from "../connectors/bigquery-connector";
import { MySQLConnector } from "../connectors/mysql-connector";
import { PostgresConnector } from "../connectors/postgres-connector";
import { SQLiteConnector } from "../connectors/sqlite-connector";
import { TiDBConnector } from "../connectors/tidb-connector";
import type { DataConnector } from "./connector-types";

export class ConnectorRegistry {
  private readonly connectors = new Map<ConnectorKind, DataConnector>();

  constructor() {
    this.register(new MySQLConnector());
    this.register(new TiDBConnector());
    this.register(new PostgresConnector());
    this.register(new SQLiteConnector());
    this.register(new BigQueryConnector());
  }

  register(connector: DataConnector): void {
    this.connectors.set(connector.manifest.kind, connector);
  }

  listManifests(): ConnectorManifest[] {
    return Array.from(this.connectors.values())
      .map((item) => item.manifest)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  getByKind(kind: ConnectorKind): DataConnector {
    const connector = this.connectors.get(kind);
    if (!connector) {
      throw new Error(`connector '${kind}' is not registered`);
    }
    return connector;
  }

  getByProfile(profile: ConnectionProfile): DataConnector {
    return this.getByKind(profile.kind);
  }
}
