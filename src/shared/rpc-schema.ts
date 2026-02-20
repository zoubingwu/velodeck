import type {
  AdapterCapabilities,
  AppEventPayloadMap,
  CancelAgentRunInput,
  ConnectionDetails,
  ConnectionMetadata,
  ExtractMetadataInput,
  GetTableDataInput,
  NamespaceRef,
  SQLResult,
  StartAgentRunOutput,
  TableDataResponse,
  TableRef,
  TableSchema,
  ThemeSettings,
  WindowSettings,
} from "./contracts";

type EmptyParams = Record<never, never>;
type EmptyRequests = Record<never, never>;
type EmptyMessages = Record<never, never>;

type RPCSideSchema<Requests, Messages> = {
  requests: Requests;
  messages: Messages;
};

type BunRequests = {
  testConnection: {
    params: { details: ConnectionDetails };
    response: boolean;
  };
  connectUsingSaved: {
    params: { connectionId: string };
    response: ConnectionDetails;
  };
  disconnect: {
    params: EmptyParams;
    response: void;
  };
  getActiveConnection: {
    params: EmptyParams;
    response: ConnectionDetails | null;
  };
  listSavedConnections: {
    params: EmptyParams;
    response: Record<string, ConnectionDetails>;
  };
  saveConnection: {
    params: { details: ConnectionDetails };
    response: string;
  };
  deleteSavedConnection: {
    params: { connectionId: string };
    response: void;
  };
  executeSQL: {
    params: { query: string };
    response: SQLResult;
  };
  getVersion: {
    params: EmptyParams;
    response: string;
  };
  getConnectionCapabilities: {
    params: EmptyParams;
    response: AdapterCapabilities;
  };
  listNamespaces: {
    params: EmptyParams;
    response: NamespaceRef[];
  };
  listTables: {
    params: { namespaceName: string };
    response: TableRef[];
  };
  getTableData: {
    params: GetTableDataInput;
    response: TableDataResponse;
  };
  getTableSchema: {
    params: { namespaceName: string; tableName: string };
    response: TableSchema;
  };
  getThemeSettings: {
    params: EmptyParams;
    response: ThemeSettings;
  };
  saveThemeSettings: {
    params: { settings: ThemeSettings };
    response: void;
  };
  getWindowSettings: {
    params: EmptyParams;
    response: WindowSettings;
  };
  saveWindowSettings: {
    params: { settings: WindowSettings };
    response: void;
  };
  getDatabaseMetadata: {
    params: EmptyParams;
    response: ConnectionMetadata;
  };
  extractDatabaseMetadata: {
    params: ExtractMetadataInput;
    response: ConnectionMetadata;
  };
  startAgentRun: {
    params: { prompt: string };
    response: StartAgentRunOutput;
  };
  cancelAgentRun: {
    params: CancelAgentRunInput;
    response: void;
  };
  windowIsMaximised: {
    params: EmptyParams;
    response: boolean;
  };
  windowMaximise: {
    params: EmptyParams;
    response: void;
  };
  windowUnmaximise: {
    params: EmptyParams;
    response: void;
  };
  clipboardGetText: {
    params: EmptyParams;
    response: string;
  };
  pickSQLiteFile: {
    params: { currentPath?: string };
    response: string;
  };
};

export type AppRPCSchema = {
  bun: RPCSideSchema<BunRequests, EmptyMessages>;
  webview: RPCSideSchema<EmptyRequests, AppEventPayloadMap>;
};
