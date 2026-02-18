import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ConnectionDetails,
  ConnectionMetadata,
  DescriptionTarget,
} from "../../shared/contracts";
import { CONFIG_DIR_NAME, METADATA_DIR_NAME } from "../../shared/contracts";
import { ConfigService } from "./config-service";
import { DatabaseGatewayService } from "./database-gateway-service";

function isSystemNamespace(
  details: ConnectionDetails,
  namespaceName: string,
): boolean {
  if (details.kind !== "mysql") {
    return false;
  }

  const systemNamespaces = new Set([
    "information_schema",
    "performance_schema",
    "metrics_schema",
    "lightning_task_info",
    "mysql",
    "sys",
  ]);

  return systemNamespaces.has(namespaceName.toLowerCase());
}

export class MetadataService {
  private readonly metadataDir: string;
  private readonly metadata = new Map<string, ConnectionMetadata>();

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DatabaseGatewayService,
  ) {
    this.metadataDir = join(homedir(), CONFIG_DIR_NAME, METADATA_DIR_NAME);
    mkdirSync(this.metadataDir, { recursive: true, mode: 0o750 });
  }

  private metadataFilePath(connectionId: string): string {
    return join(this.metadataDir, `${connectionId}.json`);
  }

  private createEmptyMetadata(
    connectionId: string,
    connectionName: string,
  ): ConnectionMetadata {
    return {
      connectionId,
      connectionName,
      lastExtracted: "",
      namespaces: {},
    };
  }

  loadMetadata(connectionId: string): ConnectionMetadata {
    const cached = this.metadata.get(connectionId);
    if (cached) {
      return cached;
    }

    const { details, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const filePath = this.metadataFilePath(connectionId);
    if (!existsSync(filePath)) {
      const empty = this.createEmptyMetadata(
        connectionId,
        details.name || connectionId,
      );
      this.metadata.set(connectionId, empty);
      return empty;
    }

    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) {
      const empty = this.createEmptyMetadata(
        connectionId,
        details.name || connectionId,
      );
      this.metadata.set(connectionId, empty);
      return empty;
    }

    const parsed = JSON.parse(raw) as ConnectionMetadata & {
      databases?: ConnectionMetadata["namespaces"];
    };

    if (!parsed.connectionId) {
      parsed.connectionId = connectionId;
    }
    if (!parsed.connectionName) {
      parsed.connectionName = details.name || connectionId;
    }

    if (!parsed.namespaces) {
      parsed.namespaces = parsed.databases || {};
    }

    if (!parsed.lastExtracted) {
      parsed.lastExtracted = "";
    }

    this.metadata.set(connectionId, parsed);
    return parsed;
  }

  getMetadata(connectionId: string): ConnectionMetadata {
    const cached = this.metadata.get(connectionId);
    if (cached) {
      return cached;
    }
    return this.loadMetadata(connectionId);
  }

  saveMetadata(connectionId: string): void {
    const metadata = this.metadata.get(connectionId);
    if (!metadata) {
      throw new Error(
        `metadata not found in memory for connection: ${connectionId}`,
      );
    }

    const filePath = this.metadataFilePath(connectionId);
    writeFileSync(filePath, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    });
  }

  async extractMetadata(
    connectionId: string,
    optionalNamespaceName?: string,
  ): Promise<ConnectionMetadata> {
    const { details, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const metadata =
      this.metadata.get(connectionId) ||
      this.createEmptyMetadata(connectionId, details.name || connectionId);
    metadata.connectionName = details.name || metadata.connectionName;

    const namespaces = await this.resolveNamespaces(
      details,
      optionalNamespaceName,
    );

    for (const namespaceName of namespaces) {
      metadata.namespaces[namespaceName] = await this.dbService.extractMetadata(
        details,
        namespaceName,
      );
    }

    metadata.lastExtracted = new Date().toISOString();
    this.metadata.set(connectionId, metadata);

    return metadata;
  }

  updateAIDescription(
    connectionId: string,
    namespaceName: string,
    target: DescriptionTarget,
    description: string,
  ): void {
    const metadata = this.getMetadata(connectionId);
    const namespaceMetadata = metadata.namespaces[namespaceName];
    if (!namespaceMetadata) {
      throw new Error(`namespace ${namespaceName} not found in metadata`);
    }

    if (target.type === "database") {
      namespaceMetadata.aiDescription = description;
      return;
    }

    if (target.type === "table") {
      const table = namespaceMetadata.tables.find(
        (item) => item.name === target.tableName,
      );
      if (!table) {
        throw new Error(`table ${target.tableName} not found`);
      }
      table.aiDescription = description;
      return;
    }

    const table = namespaceMetadata.tables.find(
      (item) => item.name === target.tableName,
    );
    if (!table) {
      throw new Error(`table ${target.tableName} not found`);
    }

    const column = table.columns.find(
      (item) => item.name === target.columnName,
    );
    if (!column) {
      throw new Error(
        `column ${target.columnName} not found in table ${target.tableName}`,
      );
    }

    column.aiDescription = description;
  }

  deleteConnectionMetadata(connectionId: string): void {
    this.metadata.delete(connectionId);
    rmSync(this.metadataFilePath(connectionId), { force: true });
  }

  private async resolveNamespaces(
    details: ConnectionDetails,
    optionalNamespaceName?: string,
  ): Promise<string[]> {
    if (optionalNamespaceName && optionalNamespaceName.trim()) {
      return [optionalNamespaceName.trim()];
    }

    const refs = await this.dbService.listNamespaces(details);
    return refs
      .map((ref) => ref.namespaceName)
      .filter((name) => name.length > 0)
      .filter((name) => !isSystemNamespace(details, name));
  }
}
