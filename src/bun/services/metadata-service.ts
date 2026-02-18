import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Column,
  type ConnectionDetails,
  type ConnectionMetadata,
  type DatabaseMetadata,
  type DescriptionTarget,
  type ForeignKey,
  type Index,
  type Table,
  CONFIG_DIR_NAME,
  METADATA_DIR_NAME,
} from "../../shared/contracts";
import { ConfigService } from "./config-service";
import { DatabaseService } from "./db-service";

function isSystemDatabase(dbName: string): boolean {
  const systemDBs = new Set([
    "information_schema",
    "performance_schema",
    "metrics_schema",
    "lightning_task_info",
    "mysql",
    "sys",
  ]);

  return systemDBs.has(dbName.toLowerCase());
}

function toBoolFromYesNo(input: unknown): boolean {
  return String(input).toUpperCase() === "YES";
}

function toNumber(input: unknown): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

export class MetadataService {
  private readonly metadataDir: string;
  private readonly metadata = new Map<string, ConnectionMetadata>();

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DatabaseService,
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
      databases: {},
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
      const empty = this.createEmptyMetadata(connectionId, details.name || connectionId);
      this.metadata.set(connectionId, empty);
      return empty;
    }

    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) {
      const empty = this.createEmptyMetadata(connectionId, details.name || connectionId);
      this.metadata.set(connectionId, empty);
      return empty;
    }

    const parsed = JSON.parse(raw) as ConnectionMetadata;
    if (!parsed.connectionId) {
      parsed.connectionId = connectionId;
    }
    if (!parsed.connectionName) {
      parsed.connectionName = details.name || connectionId;
    }
    if (!parsed.databases) {
      parsed.databases = {};
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
      throw new Error(`metadata not found in memory for connection: ${connectionId}`);
    }

    const filePath = this.metadataFilePath(connectionId);
    writeFileSync(filePath, JSON.stringify(metadata, null, 2), {
      mode: 0o600,
    });
  }

  async extractMetadata(
    connectionId: string,
    optionalDbName?: string,
  ): Promise<ConnectionMetadata> {
    const { details, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const metadata = this.metadata.get(connectionId) ||
      this.createEmptyMetadata(connectionId, details.name || connectionId);
    metadata.connectionName = details.name || metadata.connectionName;

    let databasesToExtract: string[] = [];
    if (optionalDbName && optionalDbName.trim()) {
      databasesToExtract = [optionalDbName.trim()];
    } else {
      const allDatabases = await this.dbService.listDatabases(details);
      databasesToExtract = allDatabases.filter((dbName) => !isSystemDatabase(dbName));
    }

    for (const dbName of databasesToExtract) {
      metadata.databases[dbName] = await this.extractDatabaseMetadata(details, dbName);
    }

    metadata.lastExtracted = new Date().toISOString();
    this.metadata.set(connectionId, metadata);

    return metadata;
  }

  updateAIDescription(
    connectionId: string,
    dbName: string,
    target: DescriptionTarget,
    description: string,
  ): void {
    const metadata = this.getMetadata(connectionId);
    const dbMetadata = metadata.databases[dbName];
    if (!dbMetadata) {
      throw new Error(`database ${dbName} not found in metadata`);
    }

    if (target.type === "database") {
      dbMetadata.aiDescription = description;
      return;
    }

    if (target.type === "table") {
      const table = dbMetadata.tables.find((item) => item.name === target.tableName);
      if (!table) {
        throw new Error(`table ${target.tableName} not found`);
      }
      table.aiDescription = description;
      return;
    }

    const table = dbMetadata.tables.find((item) => item.name === target.tableName);
    if (!table) {
      throw new Error(`table ${target.tableName} not found`);
    }

    const column = table.columns.find((item) => item.name === target.columnName);
    if (!column) {
      throw new Error(`column ${target.columnName} not found in table ${target.tableName}`);
    }

    column.aiDescription = description;
  }

  deleteConnectionMetadata(connectionId: string): void {
    this.metadata.delete(connectionId);
    rmSync(this.metadataFilePath(connectionId), { force: true });
  }

  private async extractDatabaseMetadata(
    connectionDetails: ConnectionDetails,
    dbName: string,
  ): Promise<DatabaseMetadata> {
    const conn = {
      ...connectionDetails,
      dbName,
    };

    const tables = await this.dbService.listTables(conn, dbName);

    const dbMetadata: DatabaseMetadata = {
      name: dbName,
      tables: [],
      graph: {},
    };

    const dbCommentResult = await this.dbService.executeSQL(
      conn,
      `SELECT SCHEMA_COMMENT FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${dbName.replace(/'/g, "''")}';`,
    );

    const dbComment = dbCommentResult.rows?.[0]?.SCHEMA_COMMENT;
    if (typeof dbComment === "string" && dbComment.length > 0) {
      dbMetadata.dbComment = dbComment;
    }

    for (const tableName of tables) {
      const table = await this.extractTableMetadata(conn, dbName, tableName);
      dbMetadata.tables.push(table);

      for (const fk of table.foreignKeys || []) {
        if (fk.columnNames.length && fk.refColumnNames.length) {
          if (!dbMetadata.graph) {
            dbMetadata.graph = {};
          }
          dbMetadata.graph[table.name] = dbMetadata.graph[table.name] || [];
          dbMetadata.graph[table.name].push({
            toTable: fk.refTableName,
            fromColumn: fk.columnNames[0],
            toColumn: fk.refColumnNames[0],
          });
        }
      }
    }

    return dbMetadata;
  }

  private async extractTableMetadata(
    connectionDetails: ConnectionDetails,
    dbName: string,
    tableName: string,
  ): Promise<Table> {
    const table: Table = {
      name: tableName,
      columns: [],
      foreignKeys: [],
      indexes: [],
    };

    const tableSchema = await this.dbService.getTableSchema(
      connectionDetails,
      dbName,
      tableName,
    );

    const tableCommentResult = await this.dbService.executeSQL(
      connectionDetails,
      `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}';`,
    );
    const tableComment = tableCommentResult.rows?.[0]?.TABLE_COMMENT;
    if (typeof tableComment === "string" && tableComment.length > 0) {
      table.dbComment = tableComment;
    }

    const columnCommentsResult = await this.dbService.executeSQL(
      connectionDetails,
      `SELECT COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}';`,
    );

    const columnComments: Record<string, string> = {};
    for (const row of columnCommentsResult.rows || []) {
      const columnName = row.COLUMN_NAME;
      const columnComment = row.COLUMN_COMMENT;
      if (typeof columnName === "string" && typeof columnComment === "string") {
        columnComments[columnName] = columnComment;
      }
    }

    table.columns = tableSchema.columns.map((col): Column => ({
      name: col.column_name,
      dataType: col.column_type,
      isNullable: toBoolFromYesNo(col.is_nullable),
      isPrimaryKey: false,
      autoIncrement: String(col.extra || "").toLowerCase() === "auto_increment",
      defaultValue: col.column_default.Valid ? col.column_default.String : undefined,
      dbComment: columnComments[col.column_name] || "",
    }));

    const foreignKeysResult = await this.dbService.executeSQL(
      connectionDetails,
      `
      SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}' AND REFERENCED_TABLE_NAME IS NOT NULL;
      `,
    );

    const fkMap = new Map<string, ForeignKey>();
    for (const row of foreignKeysResult.rows || []) {
      const constraintName = String(row.CONSTRAINT_NAME || "");
      const columnName = String(row.COLUMN_NAME || "");
      const refTableName = String(row.REFERENCED_TABLE_NAME || "");
      const refColumnName = String(row.REFERENCED_COLUMN_NAME || "");

      if (!constraintName) {
        continue;
      }

      const existing = fkMap.get(constraintName);
      if (existing) {
        existing.columnNames.push(columnName);
        existing.refColumnNames.push(refColumnName);
      } else {
        fkMap.set(constraintName, {
          name: constraintName,
          columnNames: [columnName],
          refTableName,
          refColumnNames: [refColumnName],
        });
      }
    }
    table.foreignKeys = Array.from(fkMap.values());

    const indexesResult = await this.dbService.executeSQL(
      connectionDetails,
      `
      SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX;
      `,
    );

    const indexMap = new Map<string, Index>();
    for (const row of indexesResult.rows || []) {
      const indexName = String(row.INDEX_NAME || "");
      const columnName = String(row.COLUMN_NAME || "");
      const nonUnique = toNumber(row.NON_UNIQUE);
      if (!indexName) {
        continue;
      }

      const existing = indexMap.get(indexName);
      if (existing) {
        existing.columnNames.push(columnName);
      } else {
        indexMap.set(indexName, {
          name: indexName,
          columnNames: [columnName],
          isUnique: nonUnique === 0,
        });
      }
    }

    table.indexes = Array.from(indexMap.values());
    return table;
  }
}
