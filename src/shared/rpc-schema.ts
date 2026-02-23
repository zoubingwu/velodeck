import type {
  AgentSQLApprovalResolveInput,
  AppEventPayloadMap,
  CancelAgentRunInput,
  ConnectionMetadata,
  ConnectionProfile,
  ConnectorCapabilities,
  ConnectorManifest,
  DataEntityRef,
  EntityDataPage,
  EntitySchema,
  ExplorerNode,
  ExtractMetadataInput,
  ReadEntityInput,
  SQLResult,
  StartAgentRunOutput,
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
    params: { profile: ConnectionProfile };
    response: boolean;
  };
  connectUsingSaved: {
    params: { connectionId: string };
    response: ConnectionProfile;
  };
  disconnect: {
    params: EmptyParams;
    response: void;
  };
  getActiveConnection: {
    params: EmptyParams;
    response: ConnectionProfile | null;
  };
  listSavedConnections: {
    params: EmptyParams;
    response: Record<string, ConnectionProfile>;
  };
  saveConnection: {
    params: { profile: ConnectionProfile };
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
    response: ConnectorCapabilities;
  };
  listConnectors: {
    params: EmptyParams;
    response: ConnectorManifest[];
  };
  listExplorerNodes: {
    params: { parentNodeId?: string | null };
    response: ExplorerNode[];
  };
  readEntity: {
    params: ReadEntityInput;
    response: EntityDataPage;
  };
  getEntitySchema: {
    params: { entity: DataEntityRef };
    response: EntitySchema;
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
  getConnectionMetadata: {
    params: EmptyParams;
    response: ConnectionMetadata;
  };
  extractConnectionMetadata: {
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
  resolveAgentSQLApproval: {
    params: AgentSQLApprovalResolveInput;
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
