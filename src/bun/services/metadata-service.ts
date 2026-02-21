import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  Column,
  ConnectionDetails,
  ConnectionMetadata,
  DatabaseMetadata,
  DescriptionTarget,
  Edge,
  ForeignKey,
  Index,
  NamespaceKind,
  Table,
} from "../../shared/contracts";
import {
  AGENT_DIR_NAME,
  AGENT_SKILLS_DIR_NAME,
  CONFIG_DIR_NAME,
} from "../../shared/contracts";
import { ConfigService } from "./config-service";
import { DatabaseGatewayService } from "./database-gateway-service";

const DB_INDEX_SKILL_NAME = "db-index";
const REFERENCES_DIR_NAME = "references";
const CATALOG_FILE_NAME = "catalog.md";
const INDEX_FILE_NAME = "index.md";

const VALID_NAMESPACE_KINDS = new Set<NamespaceKind>([
  "database",
  "schema",
  "attached_db",
  "dataset",
]);

type NamespaceFileEntry = {
  namespaceName: string;
  fileName: string;
  tableCount: number;
};

type ParsedConnectionIndex = {
  connectionId: string;
  connectionName: string;
  connectionKind: ConnectionDetails["kind"] | string;
  locator: string;
  lastExtracted: string;
  namespaceKind: NamespaceKind;
  namespaceFiles: NamespaceFileEntry[];
};

type CatalogEntry = {
  connectionId: string;
  connectionName: string;
  connectionKind: string;
  locator: string;
  indexFile: string;
  lastExtracted: string;
};

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

function toSlug(input: string, fallback = "item"): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return normalized || fallback;
}

function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class MetadataService {
  private readonly referencesDir: string;
  private readonly catalogPath: string;
  private readonly metadata = new Map<string, ConnectionMetadata>();

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DatabaseGatewayService,
  ) {
    this.referencesDir = join(
      homedir(),
      CONFIG_DIR_NAME,
      AGENT_DIR_NAME,
      AGENT_SKILLS_DIR_NAME,
      DB_INDEX_SKILL_NAME,
      REFERENCES_DIR_NAME,
    );
    this.catalogPath = join(this.referencesDir, CATALOG_FILE_NAME);
    mkdirSync(this.referencesDir, { recursive: true, mode: 0o750 });
    this.updateCatalog();
  }

  private connectionIdentity(details: ConnectionDetails): string {
    switch (details.kind) {
      case "mysql":
      case "postgres":
        return `${details.kind}:${details.host}:${details.port}:${details.dbName}:${details.user}`;
      case "sqlite":
        return `sqlite:${details.filePath}`;
      case "bigquery":
        return `bigquery:${details.projectId}:${details.location || "global"}`;
      default:
        return "unknown";
    }
  }

  private connectionLocator(details: ConnectionDetails): string {
    let readable = "";
    switch (details.kind) {
      case "mysql":
      case "postgres":
        readable = `${details.kind}-${details.host}-${details.dbName}`;
        break;
      case "sqlite":
        readable = `sqlite-${basename(details.filePath).replace(/\.[^.]+$/, "")}`;
        break;
      case "bigquery":
        readable = `bigquery-${details.projectId}-${details.location || "global"}`;
        break;
      default:
        readable = "connection";
        break;
    }

    return `${toSlug(readable, "connection")}-${shortHash(this.connectionIdentity(details))}`;
  }

  private connectionDir(details: ConnectionDetails): string {
    return join(this.referencesDir, this.connectionLocator(details));
  }

  private connectionIndexPath(details: ConnectionDetails): string {
    return join(this.connectionDir(details), INDEX_FILE_NAME);
  }

  private namespaceFileName(namespaceName: string): string {
    return `${toSlug(namespaceName, "namespace")}-${shortHash(namespaceName)}.md`;
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

  private namespaceKindForDetails(details: ConnectionDetails): NamespaceKind {
    try {
      return this.dbService.getCapabilities(details).namespaceKind;
    } catch {
      switch (details.kind) {
        case "mysql":
          return "database";
        case "postgres":
          return "schema";
        case "sqlite":
          return "attached_db";
        case "bigquery":
          return "dataset";
        default:
          return "database";
      }
    }
  }

  private encodeCell(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "\\n");
  }

  private decodeCell(raw: string): string {
    const text = raw.trim();
    let out = "";

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char !== "\\") {
        out += char;
        continue;
      }

      const next = text[i + 1];
      if (!next) {
        out += "\\";
        continue;
      }

      if (next === "n") {
        out += "\n";
        i += 1;
        continue;
      }

      out += next;
      i += 1;
    }

    return out;
  }

  private isTableLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|");
  }

  private isTableSeparatorLine(line: string): boolean {
    return /^\s*\|[\s:|-]+\|\s*$/.test(line);
  }

  private splitMarkdownRow(line: string): string[] {
    const trimmed = line.trim();
    if (!this.isTableLine(trimmed)) {
      return [];
    }

    const body = trimmed.slice(1, -1);
    const cells: string[] = [];
    let current = "";
    let escaped = false;

    for (let i = 0; i < body.length; i += 1) {
      const char = body[i];

      if (escaped) {
        current += `\\${char}`;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "|") {
        cells.push(this.decodeCell(current));
        current = "";
        continue;
      }

      current += char;
    }

    if (escaped) {
      current += "\\";
    }
    cells.push(this.decodeCell(current));

    return cells.map((cell) => cell.trim());
  }

  private formatMarkdownTable(headers: string[], rows: string[][]): string[] {
    const headerLine = `| ${headers.join(" | ")} |`;
    const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
    const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerLine, separatorLine, ...rowLines];
  }

  private readMarkdownTableAt(
    lines: string[],
    startIndex: number,
  ): { headers: string[]; rows: string[][]; nextIndex: number } | null {
    let cursor = startIndex;
    while (cursor < lines.length && lines[cursor].trim() === "") {
      cursor += 1;
    }

    if (cursor >= lines.length || !this.isTableLine(lines[cursor])) {
      return null;
    }

    const headers = this.splitMarkdownRow(lines[cursor]);
    cursor += 1;

    if (cursor < lines.length && this.isTableSeparatorLine(lines[cursor])) {
      cursor += 1;
    }

    const rows: string[][] = [];
    while (cursor < lines.length && this.isTableLine(lines[cursor])) {
      const row = this.splitMarkdownRow(lines[cursor]);
      if (row.length > 0) {
        rows.push(row);
      }
      cursor += 1;
    }

    return {
      headers,
      rows,
      nextIndex: cursor,
    };
  }

  private normalizeHeader(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  private tableRowsToObjects(
    headers: string[],
    rows: string[][],
  ): Array<Record<string, string>> {
    const normalizedHeaders = headers.map((header) =>
      this.normalizeHeader(header),
    );

    return rows.map((row) => {
      const item: Record<string, string> = {};
      for (let i = 0; i < normalizedHeaders.length; i += 1) {
        item[normalizedHeaders[i]] = row[i] || "";
      }
      return item;
    });
  }

  private parseBulletMap(lines: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## ")) {
        break;
      }

      const matched = trimmed.match(/^- ([^:]+):\s*(.*)$/);
      if (!matched) {
        continue;
      }

      map.set(this.normalizeHeader(matched[1]), this.decodeCell(matched[2]));
    }
    return map;
  }

  private parseYesNo(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "yes" || normalized === "true" || normalized === "1";
  }

  private formatYesNo(value: boolean): string {
    return value ? "yes" : "no";
  }

  private parseStringList(value: string): string[] {
    if (!value.trim()) {
      return [];
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private formatStringList(values: string[]): string {
    return values.join(", ");
  }

  private coerceNamespaceKind(
    value: string,
    fallback: NamespaceKind,
  ): NamespaceKind {
    if (VALID_NAMESPACE_KINDS.has(value as NamespaceKind)) {
      return value as NamespaceKind;
    }
    return fallback;
  }

  private parseConnectionIndex(markdown: string): ParsedConnectionIndex | null {
    const lines = markdown.split(/\r?\n/);
    const bullets = this.parseBulletMap(lines);

    const connectionId = bullets.get("connectionid") || "";
    const connectionName = bullets.get("connectionname") || "";
    const connectionKind = bullets.get("connectionkind") || "";
    const locator = bullets.get("locator") || "";
    const lastExtracted = bullets.get("lastextracted") || "";
    const namespaceKind = this.coerceNamespaceKind(
      bullets.get("namespacekind") || "",
      "database",
    );

    const sectionIndex = lines.findIndex(
      (line) => line.trim() === "## Namespace Files",
    );
    const namespaceFiles: NamespaceFileEntry[] = [];
    if (sectionIndex >= 0) {
      const table = this.readMarkdownTableAt(lines, sectionIndex + 1);
      if (table) {
        const rows = this.tableRowsToObjects(table.headers, table.rows);
        for (const row of rows) {
          const namespaceName = row.namespace || "";
          const fileName = row.file || "";
          const tableCount = Number.parseInt(row.tables || "0", 10);
          if (!namespaceName || !fileName) {
            continue;
          }
          namespaceFiles.push({
            namespaceName,
            fileName,
            tableCount: Number.isFinite(tableCount) ? tableCount : 0,
          });
        }
      }
    }

    if (!locator || !connectionId) {
      return null;
    }

    return {
      connectionId,
      connectionName,
      connectionKind,
      locator,
      lastExtracted,
      namespaceKind,
      namespaceFiles,
    };
  }

  private buildGraphFromTables(tables: Table[]): Record<string, Edge[]> {
    const graph: Record<string, Edge[]> = {};

    for (const table of tables) {
      for (const fk of table.foreignKeys || []) {
        if (!fk.columnNames.length || !fk.refColumnNames.length) {
          continue;
        }

        graph[table.name] ||= [];
        graph[table.name].push({
          toTable: fk.refTableName,
          fromColumn: fk.columnNames[0],
          toColumn: fk.refColumnNames[0],
        });
      }
    }

    return graph;
  }

  private parseNamespaceMarkdown(
    markdown: string,
    fallbackNamespaceName: string,
    fallbackNamespaceKind: NamespaceKind,
  ): DatabaseMetadata | null {
    const lines = markdown.split(/\r?\n/);
    const bullets = this.parseBulletMap(lines);

    const namespaceName = bullets.get("namespace") || fallbackNamespaceName;
    const namespaceKind = this.coerceNamespaceKind(
      bullets.get("namespacekind") || "",
      fallbackNamespaceKind,
    );

    const metadataSectionIndex = lines.findIndex(
      (line) => line.trim() === "## Namespace Metadata",
    );

    let namespaceDbComment = "";
    let namespaceAIDescription = "";
    if (metadataSectionIndex >= 0) {
      const table = this.readMarkdownTableAt(lines, metadataSectionIndex + 1);
      if (table) {
        const rows = this.tableRowsToObjects(table.headers, table.rows);
        for (const row of rows) {
          const field = (row.field || "").trim().toLowerCase();
          if (field === "db comment") {
            namespaceDbComment = row.value || "";
          } else if (field === "ai description") {
            namespaceAIDescription = row.value || "";
          }
        }
      }
    }

    const tables: Table[] = [];
    let cursor = 0;
    while (cursor < lines.length) {
      const heading = lines[cursor].trim();
      const matched = heading.match(/^## Table:\s*(.+)$/);
      if (!matched) {
        cursor += 1;
        continue;
      }

      const tableName = matched[1].trim();
      const table: Table = {
        name: tableName,
        columns: [],
        foreignKeys: [],
        indexes: [],
      };

      cursor += 1;
      while (cursor < lines.length) {
        const line = lines[cursor].trim();
        if (line.startsWith("## Table:")) {
          break;
        }

        if (line === "### Metadata") {
          const parsed = this.readMarkdownTableAt(lines, cursor + 1);
          if (parsed) {
            const rows = this.tableRowsToObjects(parsed.headers, parsed.rows);
            for (const row of rows) {
              const field = (row.field || "").trim().toLowerCase();
              if (field === "db comment") {
                table.dbComment = row.value || "";
              } else if (field === "ai description") {
                table.aiDescription = row.value || undefined;
              }
            }
            cursor = parsed.nextIndex;
            continue;
          }
        }

        if (line === "### Columns") {
          const parsed = this.readMarkdownTableAt(lines, cursor + 1);
          if (parsed) {
            const rows = this.tableRowsToObjects(parsed.headers, parsed.rows);
            const columns: Column[] = [];
            for (const row of rows) {
              const name = row.name || "";
              if (!name) {
                continue;
              }

              const defaultValue = row.default || "";
              const aiDescription = row.aidescription || "";
              columns.push({
                name,
                dataType: row.type || "",
                isNullable: this.parseYesNo(row.nullable || ""),
                isPrimaryKey: this.parseYesNo(row.primarykey || ""),
                autoIncrement: this.parseYesNo(row.autoincrement || ""),
                defaultValue: defaultValue ? defaultValue : undefined,
                dbComment: row.dbcomment || "",
                aiDescription: aiDescription || undefined,
              });
            }
            table.columns = columns;
            cursor = parsed.nextIndex;
            continue;
          }
        }

        if (line === "### Foreign Keys") {
          const parsed = this.readMarkdownTableAt(lines, cursor + 1);
          if (parsed) {
            const rows = this.tableRowsToObjects(parsed.headers, parsed.rows);
            const foreignKeys: ForeignKey[] = [];
            for (const row of rows) {
              const name = row.name || "";
              if (!name) {
                continue;
              }

              foreignKeys.push({
                name,
                columnNames: this.parseStringList(row.columns || ""),
                refTableName: row.reftable || "",
                refColumnNames: this.parseStringList(row.refcolumns || ""),
              });
            }
            table.foreignKeys = foreignKeys;
            cursor = parsed.nextIndex;
            continue;
          }
        }

        if (line === "### Indexes") {
          const parsed = this.readMarkdownTableAt(lines, cursor + 1);
          if (parsed) {
            const rows = this.tableRowsToObjects(parsed.headers, parsed.rows);
            const indexes: Index[] = [];
            for (const row of rows) {
              const name = row.name || "";
              if (!name) {
                continue;
              }

              indexes.push({
                name,
                columnNames: this.parseStringList(row.columns || ""),
                isUnique: this.parseYesNo(row.unique || ""),
              });
            }
            table.indexes = indexes;
            cursor = parsed.nextIndex;
            continue;
          }
        }

        cursor += 1;
      }

      tables.push(table);
    }

    const metadata: DatabaseMetadata = {
      name: namespaceName,
      namespaceKind,
      tables,
      graph: this.buildGraphFromTables(tables),
    };

    if (namespaceDbComment) {
      metadata.dbComment = namespaceDbComment;
    }
    if (namespaceAIDescription) {
      metadata.aiDescription = namespaceAIDescription;
    }

    return metadata;
  }

  private renderNamespaceMarkdown(
    metadata: ConnectionMetadata,
    details: ConnectionDetails,
    locator: string,
    namespaceName: string,
    namespace: DatabaseMetadata,
  ): string {
    const lines: string[] = [
      "# Namespace Schema Index",
      "",
      `- Connection ID: ${this.encodeCell(metadata.connectionId)}`,
      `- Connection Name: ${this.encodeCell(metadata.connectionName)}`,
      `- Connection Kind: ${this.encodeCell(details.kind)}`,
      `- Locator: ${this.encodeCell(locator)}`,
      `- Namespace: ${this.encodeCell(namespaceName)}`,
      `- Namespace Kind: ${this.encodeCell(namespace.namespaceKind)}`,
      `- Last Extracted: ${this.encodeCell(metadata.lastExtracted || "")}`,
      `- Generated At: ${this.encodeCell(new Date().toISOString())}`,
      "",
      "## Namespace Metadata",
      ...this.formatMarkdownTable(
        ["Field", "Value"],
        [
          ["DB Comment", this.encodeCell(namespace.dbComment || "")],
          ["AI Description", this.encodeCell(namespace.aiDescription || "")],
        ],
      ),
      "",
      "## Table Directory",
      ...this.formatMarkdownTable(
        ["Table", "Columns", "Foreign Keys", "Indexes"],
        namespace.tables.map((table) => [
          this.encodeCell(table.name),
          String(table.columns.length),
          String(table.foreignKeys?.length || 0),
          String(table.indexes?.length || 0),
        ]),
      ),
      "",
    ];

    for (const table of namespace.tables) {
      lines.push(`## Table: ${this.encodeCell(table.name)}`);
      lines.push("");
      lines.push("### Metadata");
      lines.push(
        ...this.formatMarkdownTable(
          ["Field", "Value"],
          [
            ["DB Comment", this.encodeCell(table.dbComment || "")],
            ["AI Description", this.encodeCell(table.aiDescription || "")],
          ],
        ),
      );
      lines.push("");
      lines.push("### Columns");
      lines.push(
        ...this.formatMarkdownTable(
          [
            "Name",
            "Type",
            "Nullable",
            "Primary Key",
            "Auto Increment",
            "Default",
            "DB Comment",
            "AI Description",
          ],
          table.columns.map((column) => [
            this.encodeCell(column.name),
            this.encodeCell(column.dataType),
            this.formatYesNo(column.isNullable),
            this.formatYesNo(column.isPrimaryKey),
            this.formatYesNo(column.autoIncrement),
            this.encodeCell(column.defaultValue ?? ""),
            this.encodeCell(column.dbComment || ""),
            this.encodeCell(column.aiDescription || ""),
          ]),
        ),
      );
      lines.push("");
      lines.push("### Foreign Keys");
      lines.push(
        ...this.formatMarkdownTable(
          ["Name", "Columns", "Ref Table", "Ref Columns"],
          (table.foreignKeys || []).map((fk) => [
            this.encodeCell(fk.name),
            this.encodeCell(this.formatStringList(fk.columnNames)),
            this.encodeCell(fk.refTableName),
            this.encodeCell(this.formatStringList(fk.refColumnNames)),
          ]),
        ),
      );
      lines.push("");
      lines.push("### Indexes");
      lines.push(
        ...this.formatMarkdownTable(
          ["Name", "Columns", "Unique"],
          (table.indexes || []).map((index) => [
            this.encodeCell(index.name),
            this.encodeCell(this.formatStringList(index.columnNames)),
            this.formatYesNo(index.isUnique),
          ]),
        ),
      );
      lines.push("");
    }

    return lines.join("\n");
  }

  private renderConnectionIndexMarkdown(
    metadata: ConnectionMetadata,
    details: ConnectionDetails,
    locator: string,
    namespaceKind: NamespaceKind,
    namespaceFiles: NamespaceFileEntry[],
  ): string {
    const rows = namespaceFiles.map((entry) => [
      this.encodeCell(entry.namespaceName),
      this.encodeCell(entry.fileName),
      String(entry.tableCount),
    ]);

    const lines = [
      "# Connection Schema Index",
      "",
      `- Connection ID: ${this.encodeCell(metadata.connectionId)}`,
      `- Connection Name: ${this.encodeCell(metadata.connectionName)}`,
      `- Connection Kind: ${this.encodeCell(details.kind)}`,
      `- Locator: ${this.encodeCell(locator)}`,
      `- Last Extracted: ${this.encodeCell(metadata.lastExtracted || "")}`,
      `- Namespace Kind: ${this.encodeCell(namespaceKind)}`,
      `- Namespace Count: ${namespaceFiles.length}`,
      "",
      "## Namespace Files",
      ...this.formatMarkdownTable(["Namespace", "File", "Tables"], rows),
      "",
    ];

    return lines.join("\n");
  }

  private parseCatalog(markdown: string): CatalogEntry[] {
    const lines = markdown.split(/\r?\n/);
    const sectionIndex = lines.findIndex(
      (line) => line.trim() === "## Connections",
    );
    if (sectionIndex < 0) {
      return [];
    }

    const table = this.readMarkdownTableAt(lines, sectionIndex + 1);
    if (!table) {
      return [];
    }

    const rows = this.tableRowsToObjects(table.headers, table.rows);
    const entries: CatalogEntry[] = [];
    for (const row of rows) {
      const connectionId = row.connectionid || "";
      const locator = row.locator || "";
      const indexFile = row.indexfile || "";

      if (!connectionId || !locator || !indexFile) {
        continue;
      }

      entries.push({
        connectionId,
        connectionName: row.connectionname || "",
        connectionKind: row.connectionkind || "",
        locator,
        indexFile,
        lastExtracted: row.lastextracted || "",
      });
    }

    return entries;
  }

  private renderCatalogMarkdown(entries: CatalogEntry[]): string {
    const rows = entries
      .sort((a, b) =>
        `${a.connectionName}:${a.connectionKind}`.localeCompare(
          `${b.connectionName}:${b.connectionKind}`,
        ),
      )
      .map((entry) => [
        this.encodeCell(entry.connectionName),
        this.encodeCell(entry.connectionKind),
        this.encodeCell(entry.locator),
        this.encodeCell(entry.indexFile),
        this.encodeCell(entry.lastExtracted || ""),
        this.encodeCell(entry.connectionId),
      ]);

    const lines = [
      "# DB Index Catalog",
      "",
      `- Generated At: ${this.encodeCell(new Date().toISOString())}`,
      "",
      "## Connections",
      ...this.formatMarkdownTable(
        [
          "Connection Name",
          "Connection Kind",
          "Locator",
          "Index File",
          "Last Extracted",
          "Connection ID",
        ],
        rows,
      ),
      "",
    ];

    return lines.join("\n");
  }

  private readConnectionIndexFromPath(
    indexPath: string,
  ): ParsedConnectionIndex | null {
    if (!existsSync(indexPath)) {
      return null;
    }

    const raw = readFileSync(indexPath, "utf8");
    return this.parseConnectionIndex(raw);
  }

  private listConnectionDirectories(): Dirent[] {
    return readdirSync(this.referencesDir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory(),
    );
  }

  private listCatalogEntriesFromDisk(): CatalogEntry[] {
    const entries: CatalogEntry[] = [];

    for (const directory of this.listConnectionDirectories()) {
      const indexPath = join(
        this.referencesDir,
        directory.name,
        INDEX_FILE_NAME,
      );
      const parsed = this.readConnectionIndexFromPath(indexPath);
      if (!parsed) {
        continue;
      }

      entries.push({
        connectionId: parsed.connectionId,
        connectionName: parsed.connectionName,
        connectionKind: parsed.connectionKind,
        locator: parsed.locator || directory.name,
        indexFile: `${directory.name}/${INDEX_FILE_NAME}`,
        lastExtracted: parsed.lastExtracted,
      });
    }

    return entries;
  }

  private updateCatalog(): void {
    mkdirSync(this.referencesDir, { recursive: true, mode: 0o750 });
    writeFileSync(
      this.catalogPath,
      this.renderCatalogMarkdown(this.listCatalogEntriesFromDisk()),
      { mode: 0o600 },
    );
  }

  private findIndexPathByConnectionId(connectionId: string): string | null {
    if (!existsSync(this.catalogPath)) {
      return null;
    }

    const catalog = this.parseCatalog(readFileSync(this.catalogPath, "utf8"));
    const matched = catalog.find(
      (entry) => entry.connectionId === connectionId,
    );
    if (!matched) {
      return null;
    }

    const safeIndexFile =
      matched.indexFile.includes("..") ||
      matched.indexFile.startsWith("/") ||
      matched.indexFile.includes("\\")
        ? ""
        : matched.indexFile;
    if (!safeIndexFile) {
      return null;
    }

    const indexPath = join(this.referencesDir, safeIndexFile);
    if (!existsSync(indexPath)) {
      return null;
    }

    return indexPath;
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

    const result = this.createEmptyMetadata(
      connectionId,
      details.name || connectionId,
    );

    let indexPath = this.connectionIndexPath(details);
    if (!existsSync(indexPath)) {
      const fallback = this.findIndexPathByConnectionId(connectionId);
      if (fallback) {
        indexPath = fallback;
      }
    }

    const parsedIndex = this.readConnectionIndexFromPath(indexPath);
    if (!parsedIndex) {
      this.metadata.set(connectionId, result);
      return result;
    }

    result.connectionName =
      details.name || parsedIndex.connectionName || connectionId;
    result.lastExtracted = parsedIndex.lastExtracted || "";

    const indexDir = join(indexPath, "..");
    for (const entry of parsedIndex.namespaceFiles) {
      if (
        !entry.fileName ||
        entry.fileName.includes("/") ||
        entry.fileName.includes("\\") ||
        entry.fileName.includes("..")
      ) {
        continue;
      }

      const namespacePath = join(indexDir, entry.fileName);
      if (!existsSync(namespacePath)) {
        continue;
      }

      const namespaceMarkdown = readFileSync(namespacePath, "utf8");
      const namespaceMetadata = this.parseNamespaceMarkdown(
        namespaceMarkdown,
        entry.namespaceName,
        parsedIndex.namespaceKind,
      );
      if (!namespaceMetadata) {
        continue;
      }

      result.namespaces[namespaceMetadata.name] = namespaceMetadata;
    }

    this.metadata.set(connectionId, result);
    return result;
  }

  getMetadata(connectionId: string): ConnectionMetadata {
    const cached = this.metadata.get(connectionId);
    if (cached) {
      return cached;
    }
    return this.loadMetadata(connectionId);
  }

  private removeStaleConnectionDirectories(
    connectionId: string,
    currentLocator: string,
  ): void {
    const entries = this.listCatalogEntriesFromDisk().filter(
      (entry) =>
        entry.connectionId === connectionId && entry.locator !== currentLocator,
    );

    for (const entry of entries) {
      const target = join(this.referencesDir, entry.locator);
      rmSync(target, { recursive: true, force: true });
    }
  }

  saveMetadata(connectionId: string): void {
    const metadata = this.metadata.get(connectionId);
    if (!metadata) {
      throw new Error(
        `metadata not found in memory for connection: ${connectionId}`,
      );
    }

    const { details, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const locator = this.connectionLocator(details);
    const connectionDir = this.connectionDir(details);
    const namespaceKind = this.namespaceKindForDetails(details);

    this.removeStaleConnectionDirectories(connectionId, locator);
    mkdirSync(connectionDir, { recursive: true, mode: 0o750 });

    const namespaceNames = Object.keys(metadata.namespaces).sort((a, b) =>
      a.localeCompare(b),
    );

    const namespaceEntries: NamespaceFileEntry[] = [];
    for (const namespaceName of namespaceNames) {
      const namespace = metadata.namespaces[namespaceName];
      const fileName = this.namespaceFileName(namespaceName);
      const filePath = join(connectionDir, fileName);

      writeFileSync(
        filePath,
        this.renderNamespaceMarkdown(
          metadata,
          details,
          locator,
          namespaceName,
          namespace,
        ),
        { mode: 0o600 },
      );

      namespaceEntries.push({
        namespaceName,
        fileName,
        tableCount: namespace.tables.length,
      });
    }

    const expectedFiles = new Set(
      namespaceEntries.map((entry) => entry.fileName).concat([INDEX_FILE_NAME]),
    );

    const staleFiles = readdirSync(connectionDir).filter(
      (fileName) => fileName.endsWith(".md") && !expectedFiles.has(fileName),
    );
    for (const fileName of staleFiles) {
      rmSync(join(connectionDir, fileName), { force: true });
    }

    writeFileSync(
      join(connectionDir, INDEX_FILE_NAME),
      this.renderConnectionIndexMarkdown(
        metadata,
        details,
        locator,
        namespaceKind,
        namespaceEntries,
      ),
      { mode: 0o600 },
    );

    this.updateCatalog();
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

    const targets = this.listCatalogEntriesFromDisk().filter(
      (entry) => entry.connectionId === connectionId,
    );
    for (const entry of targets) {
      rmSync(join(this.referencesDir, entry.locator), {
        recursive: true,
        force: true,
      });
    }

    this.updateCatalog();
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
