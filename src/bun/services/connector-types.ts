import type {
  ConnectionProfile,
  ConnectorManifest,
  DataEntityRef,
  EntityDataPage,
  EntitySchema,
  ExplorerNode,
  ReadEntityInput,
  SQLResult,
} from "../../shared/contracts";

export interface DataConnector {
  readonly manifest: ConnectorManifest;

  validateOptions(options: Record<string, unknown>): void;
  testConnection(profile: ConnectionProfile): Promise<void>;
  getVersion(profile: ConnectionProfile): Promise<string>;

  listExplorerNodes(
    profile: ConnectionProfile,
    parentNodeId: string | null,
  ): Promise<ExplorerNode[]>;

  readEntity(
    profile: ConnectionProfile,
    input: ReadEntityInput,
  ): Promise<EntityDataPage>;

  getEntitySchema(
    profile: ConnectionProfile,
    entity: DataEntityRef,
  ): Promise<EntitySchema>;
}

export interface SQLConnector extends DataConnector {
  executeSQL(profile: ConnectionProfile, sql: string): Promise<SQLResult>;
}

export function isSQLConnector(
  connector: DataConnector,
): connector is SQLConnector {
  return connector.manifest.capabilities.supportsSqlExecution;
}
