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
  ConnectionMetadata,
  ConnectionProfile,
  DataEntityRef,
  DescriptionTarget,
  EntityMetadata,
  EntitySchema,
  ExplorerNode,
} from "../../shared/contracts";
import {
  AGENT_DIR_NAME,
  AGENT_SKILLS_DIR_NAME,
  CONFIG_DIR_NAME,
} from "../../shared/contracts";
import { ConfigService } from "./config-service";
import { ConnectorGatewayService } from "./connector-gateway-service";

const DB_INDEX_SKILL_NAME = "db-index";
const REFERENCES_DIR_NAME = "references";
const CATALOG_FILE_NAME = "catalog.md";
const INDEX_FILE_NAME = "index.md";

type CatalogEntry = {
  connectionId: string;
  connectionName: string;
  connectionKind: string;
  locator: string;
  indexFile: string;
  lastExtracted: string;
};

type EntityFileEntry = {
  key: string;
  label: string;
  fileName: string;
  fieldCount: number;
};

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

function toEntityKey(entity: DataEntityRef): string {
  return [
    entity.connectorKind,
    entity.entityType,
    entity.namespace || "",
    entity.name,
  ].join("|");
}

function parseEntityKey(key: string): DataEntityRef {
  const [connectorKind, entityType, namespace, name] = key.split("|");
  return {
    connectorKind: connectorKind || "",
    entityType: entityType || "",
    namespace: namespace || undefined,
    name: name || "",
  };
}

export class MetadataService {
  private readonly referencesDir: string;
  private readonly catalogPath: string;
  private readonly metadata = new Map<string, ConnectionMetadata>();

  constructor(
    private readonly configService: ConfigService,
    private readonly connectorService: ConnectorGatewayService,
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

  private connectionIdentity(profile: ConnectionProfile): string {
    const host = this.readOption(profile, "host");
    const port = this.readOption(profile, "port");
    const dbName = this.readOption(profile, "dbName");
    const filePath = this.readOption(profile, "filePath");
    const projectId = this.readOption(profile, "projectId");

    if (host || port || dbName) {
      return `${profile.kind}:${host}:${port}:${dbName}`;
    }

    if (filePath) {
      return `${profile.kind}:${filePath}`;
    }

    if (projectId) {
      return `${profile.kind}:${projectId}:${this.readOption(profile, "location")}`;
    }

    return `${profile.kind}:${profile.name || "connection"}`;
  }

  private connectionLocator(profile: ConnectionProfile): string {
    const host = this.readOption(profile, "host");
    const dbName = this.readOption(profile, "dbName");
    const filePath = this.readOption(profile, "filePath");
    const projectId = this.readOption(profile, "projectId");

    let readable = "";
    if (host || dbName) {
      readable = `${profile.kind}-${host}-${dbName}`;
    } else if (filePath) {
      readable = `${profile.kind}-${basename(filePath).replace(/\.[^.]+$/, "")}`;
    } else if (projectId) {
      readable = `${profile.kind}-${projectId}`;
    } else {
      readable = `${profile.kind}-${profile.name || "connection"}`;
    }

    return `${toSlug(readable, "connection")}-${shortHash(this.connectionIdentity(profile))}`;
  }

  private connectionDir(profile: ConnectionProfile): string {
    return join(this.referencesDir, this.connectionLocator(profile));
  }

  private createEmptyMetadata(
    connectionId: string,
    connectionName: string,
  ): ConnectionMetadata {
    return {
      connectionId,
      connectionName,
      lastExtracted: "",
      explorer: [],
      entities: {},
    };
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

  private formatMarkdownTable(headers: string[], rows: string[][]): string[] {
    const headerLine = `| ${headers.join(" | ")} |`;
    const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
    const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerLine, separatorLine, ...rowLines];
  }

  private readOption(profile: ConnectionProfile, key: string): string {
    const value = profile.options[key];
    if (typeof value === "string") {
      return value;
    }
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  }

  private splitMarkdownRow(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
      return [];
    }

    return trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim().replace(/\\\|/g, "|").replace(/\\n/g, "\n"));
  }

  private parseCatalog(markdown: string): CatalogEntry[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === "## Connections");
    if (start < 0) {
      return [];
    }

    const rows: CatalogEntry[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const row = this.splitMarkdownRow(lines[i]);
      if (row.length < 6 || row[0] === "Connection Name" || row[0] === "---") {
        continue;
      }

      rows.push({
        connectionName: row[0] || "",
        connectionKind: row[1] || "",
        locator: row[2] || "",
        indexFile: row[3] || "",
        lastExtracted: row[4] || "",
        connectionId: row[5] || "",
      });
    }

    return rows.filter(
      (entry) => entry.connectionId && entry.locator && entry.indexFile,
    );
  }

  private parseIndexBullets(markdown: string): CatalogEntry | null {
    const lines = markdown.split(/\r?\n/);
    const bullets = new Map<string, string>();

    for (const line of lines) {
      const matched = line.trim().match(/^- ([^:]+):\s*(.*)$/);
      if (!matched) {
        continue;
      }

      const key = matched[1]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
      bullets.set(key, matched[2].trim());
    }

    const connectionId = bullets.get("connectionid") || "";
    const locator = bullets.get("locator") || "";
    if (!connectionId || !locator) {
      return null;
    }

    return {
      connectionId,
      connectionName: bullets.get("connectionname") || "",
      connectionKind: bullets.get("connectionkind") || "",
      locator,
      indexFile: `${locator}/${INDEX_FILE_NAME}`,
      lastExtracted: bullets.get("lastextracted") || "",
    };
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

      if (!existsSync(indexPath)) {
        continue;
      }

      const parsed = this.parseIndexBullets(readFileSync(indexPath, "utf8"));
      if (!parsed) {
        continue;
      }

      entries.push(parsed);
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
      "# Explorer Index Catalog",
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

    if (
      matched.indexFile.includes("..") ||
      matched.indexFile.startsWith("/") ||
      matched.indexFile.includes("\\")
    ) {
      return null;
    }

    const indexPath = join(this.referencesDir, matched.indexFile);
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

    const { profile, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const result = this.createEmptyMetadata(
      connectionId,
      profile.name || connectionId,
    );

    const locatorIndexPath = join(this.connectionDir(profile), INDEX_FILE_NAME);
    const fallbackIndexPath = this.findIndexPathByConnectionId(connectionId);
    const indexPath = existsSync(locatorIndexPath)
      ? locatorIndexPath
      : fallbackIndexPath;

    if (indexPath) {
      const raw = readFileSync(indexPath, "utf8");
      const parsed = this.parseIndexBullets(raw);
      if (parsed?.lastExtracted) {
        result.lastExtracted = parsed.lastExtracted;
      }
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

  private entityFileName(entityKey: string): string {
    return `${toSlug(entityKey, "entity")}-${shortHash(entityKey)}.md`;
  }

  private renderEntityMarkdown(
    metadata: ConnectionMetadata,
    profile: ConnectionProfile,
    locator: string,
    entity: EntityMetadata,
  ): string {
    const lines: string[] = [
      "# Entity Metadata",
      "",
      `- Connection ID: ${this.encodeCell(metadata.connectionId)}`,
      `- Connection Name: ${this.encodeCell(metadata.connectionName)}`,
      `- Connection Kind: ${this.encodeCell(profile.kind)}`,
      `- Locator: ${this.encodeCell(locator)}`,
      `- Entity Key: ${this.encodeCell(entity.key)}`,
      `- Label: ${this.encodeCell(entity.label)}`,
      `- Last Extracted: ${this.encodeCell(metadata.lastExtracted || "")}`,
      `- Generated At: ${this.encodeCell(new Date().toISOString())}`,
      "",
      "## Entity",
      ...this.formatMarkdownTable(
        ["Field", "Value"],
        [
          ["Connector Kind", this.encodeCell(entity.entity.connectorKind)],
          ["Entity Type", this.encodeCell(entity.entity.entityType)],
          ["Namespace", this.encodeCell(entity.entity.namespace || "")],
          ["Name", this.encodeCell(entity.entity.name)],
          ["DB Comment", this.encodeCell(entity.dbComment || "")],
          ["AI Description", this.encodeCell(entity.aiDescription || "")],
        ],
      ),
      "",
      "## Fields",
      ...this.formatMarkdownTable(
        ["Name", "Type", "Nullable", "Primary Key", "Description"],
        entity.fields.map((field) => [
          this.encodeCell(field.name),
          this.encodeCell(field.type),
          field.nullable ? "yes" : "no",
          field.primaryKey ? "yes" : "no",
          this.encodeCell(field.description || ""),
        ]),
      ),
      "",
    ];

    if (entity.relationalTraits) {
      lines.push("## Relational Traits");
      lines.push(
        ...this.formatMarkdownTable(
          ["Field", "Value"],
          [
            ["Namespace", this.encodeCell(entity.relationalTraits.namespace)],
            ["Table Type", this.encodeCell(entity.relationalTraits.tableType)],
            [
              "Primary Key",
              this.encodeCell(
                (entity.relationalTraits.primaryKey || []).join(", "),
              ),
            ],
          ],
        ),
      );
      lines.push("");
    }

    return lines.join("\n");
  }

  private renderConnectionIndexMarkdown(
    metadata: ConnectionMetadata,
    profile: ConnectionProfile,
    locator: string,
    entityFiles: EntityFileEntry[],
  ): string {
    const explorerRows = metadata.explorer.map((node) => [
      this.encodeCell(node.nodeId),
      this.encodeCell(node.parentNodeId || ""),
      this.encodeCell(node.kind),
      this.encodeCell(node.label),
      node.expandable ? "yes" : "no",
      this.encodeCell(node.entityRef ? toEntityKey(node.entityRef) : ""),
    ]);

    const entityRows = entityFiles.map((entry) => [
      this.encodeCell(entry.key),
      this.encodeCell(entry.label),
      this.encodeCell(entry.fileName),
      String(entry.fieldCount),
    ]);

    const lines = [
      "# Connection Explorer Index",
      "",
      `- Connection ID: ${this.encodeCell(metadata.connectionId)}`,
      `- Connection Name: ${this.encodeCell(metadata.connectionName)}`,
      `- Connection Kind: ${this.encodeCell(profile.kind)}`,
      `- Locator: ${this.encodeCell(locator)}`,
      `- Last Extracted: ${this.encodeCell(metadata.lastExtracted || "")}`,
      `- Explorer Node Count: ${metadata.explorer.length}`,
      `- Entity Count: ${Object.keys(metadata.entities).length}`,
      "",
      "## Explorer Nodes",
      ...this.formatMarkdownTable(
        [
          "Node ID",
          "Parent Node ID",
          "Kind",
          "Label",
          "Expandable",
          "Entity Key",
        ],
        explorerRows,
      ),
      "",
      "## Entity Files",
      ...this.formatMarkdownTable(
        ["Entity Key", "Label", "File", "Fields"],
        entityRows,
      ),
      "",
    ];

    return lines.join("\n");
  }

  saveMetadata(connectionId: string): void {
    const metadata = this.metadata.get(connectionId);
    if (!metadata) {
      throw new Error(
        `metadata not found in memory for connection: ${connectionId}`,
      );
    }

    const { profile, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const locator = this.connectionLocator(profile);
    const connectionDir = this.connectionDir(profile);

    mkdirSync(connectionDir, { recursive: true, mode: 0o750 });

    const entityEntries: EntityFileEntry[] = [];
    const keys = Object.keys(metadata.entities).sort((a, b) =>
      a.localeCompare(b),
    );

    for (const key of keys) {
      const entity = metadata.entities[key];
      const fileName = this.entityFileName(key);
      const filePath = join(connectionDir, fileName);

      writeFileSync(
        filePath,
        this.renderEntityMarkdown(metadata, profile, locator, entity),
        { mode: 0o600 },
      );

      entityEntries.push({
        key,
        label: entity.label,
        fileName,
        fieldCount: entity.fields.length,
      });
    }

    const expectedFiles = new Set(
      entityEntries.map((entry) => entry.fileName).concat([INDEX_FILE_NAME]),
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
        profile,
        locator,
        entityEntries,
      ),
      { mode: 0o600 },
    );

    this.updateCatalog();
  }

  async extractMetadata(
    connectionId: string,
    optionalScopeNodeId?: string,
  ): Promise<ConnectionMetadata> {
    const { profile, found } = this.configService.getConnection(connectionId);
    if (!found) {
      throw new Error(`connection not found: ${connectionId}`);
    }

    const metadata = this.createEmptyMetadata(
      connectionId,
      profile.name || connectionId,
    );

    const visitedParents = new Set<string>();
    const queue: Array<string | null> =
      optionalScopeNodeId && optionalScopeNodeId.trim()
        ? [optionalScopeNodeId.trim()]
        : [null];

    while (queue.length > 0) {
      const parentNodeId = queue.shift() ?? null;
      const parentKey = parentNodeId || "";
      if (visitedParents.has(parentKey)) {
        continue;
      }
      visitedParents.add(parentKey);

      const nodes = await this.connectorService.listExplorerNodes(
        profile,
        parentNodeId,
      );
      for (const node of nodes) {
        metadata.explorer.push(node);
        if (node.expandable) {
          queue.push(node.nodeId);
        }
      }
    }

    const entityNodes = metadata.explorer.filter((node) => node.entityRef);

    for (const node of entityNodes) {
      const entityRef = node.entityRef as DataEntityRef;
      const schema = await this.connectorService.getEntitySchema(
        profile,
        entityRef,
      );
      const key = toEntityKey(schema.entity);

      metadata.entities[key] = {
        key,
        label: node.label,
        entity: schema.entity,
        fields: schema.fields,
        relationalTraits: schema.relationalTraits,
      };
    }

    metadata.lastExtracted = new Date().toISOString();
    this.metadata.set(connectionId, metadata);

    return metadata;
  }

  updateAIDescription(
    connectionId: string,
    _scopeNodeId: string,
    target: DescriptionTarget,
    description: string,
  ): void {
    const metadata = this.getMetadata(connectionId);
    const entity = metadata.entities[target.entityKey];
    if (!entity) {
      throw new Error(`entity ${target.entityKey} not found in metadata`);
    }

    if (target.type === "entity") {
      entity.aiDescription = description;
      return;
    }

    const field = entity.fields.find((item) => item.name === target.fieldName);
    if (!field) {
      throw new Error(
        `field ${target.fieldName} not found in entity ${target.entityKey}`,
      );
    }

    field.description = description;
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
}

export { parseEntityKey, toEntityKey };
