import type {
  ConnectionProfile,
  ConnectorCapabilities,
  ConnectorManifest,
  DataEntityRef,
  EntityDataPage,
  EntitySchema,
  ExplorerNode,
  ReadEntityInput,
  SQLResult,
} from "../../shared/contracts";
import { ConnectorRegistry } from "./connector-registry";
import { isSQLConnector } from "./connector-types";

export class ConnectorGatewayService {
  private readonly registry: ConnectorRegistry;

  constructor(registry?: ConnectorRegistry) {
    this.registry = registry || new ConnectorRegistry();
  }

  listConnectors(): ConnectorManifest[] {
    return this.registry.listManifests();
  }

  getConnectionCapabilities(profile: ConnectionProfile): ConnectorCapabilities {
    return this.registry.getByProfile(profile).manifest.capabilities;
  }

  async testConnection(profile: ConnectionProfile): Promise<boolean> {
    const connector = this.registry.getByProfile(profile);
    connector.validateOptions(profile.options);
    await connector.testConnection(profile);
    return true;
  }

  async executeSQL(
    profile: ConnectionProfile,
    query: string,
  ): Promise<SQLResult> {
    const connector = this.registry.getByProfile(profile);
    if (!isSQLConnector(connector)) {
      throw new Error(
        `connector '${profile.kind}' does not support SQL execution`,
      );
    }

    return connector.executeSQL(profile, query);
  }

  async getVersion(profile: ConnectionProfile): Promise<string> {
    const connector = this.registry.getByProfile(profile);
    return connector.getVersion(profile);
  }

  async listExplorerNodes(
    profile: ConnectionProfile,
    parentNodeId: string | null,
  ): Promise<ExplorerNode[]> {
    const connector = this.registry.getByProfile(profile);
    return connector.listExplorerNodes(profile, parentNodeId);
  }

  async readEntity(
    profile: ConnectionProfile,
    input: ReadEntityInput,
  ): Promise<EntityDataPage> {
    const connector = this.registry.getByProfile(profile);
    return connector.readEntity(profile, input);
  }

  async getEntitySchema(
    profile: ConnectionProfile,
    entity: DataEntityRef,
  ): Promise<EntitySchema> {
    const connector = this.registry.getByProfile(profile);
    return connector.getEntitySchema(profile, entity);
  }
}
