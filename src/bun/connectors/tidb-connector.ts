import type { ConnectorManifest } from "../../shared/contracts";
import { SQLMySQLFamilyBaseConnector } from "./sql-mysql-family-base";

const TIDB_MANIFEST: ConnectorManifest = {
  kind: "tidb",
  label: "TiDB",
  category: "sql",
  capabilities: {
    supportsSqlExecution: true,
    supportsSchemaInspection: true,
    supportsServerSideFilter: true,
    supportsPagination: true,
    supportsMetadataExtraction: true,
  },
  formFields: [
    {
      key: "host",
      label: "Host",
      type: "text",
      required: true,
      placeholder: "gateway01.us-east-1.prod.aws.tidbcloud.com",
    },
    {
      key: "port",
      label: "Port",
      type: "text",
      required: true,
      defaultValue: "4000",
    },
    {
      key: "user",
      label: "User",
      type: "text",
      required: true,
    },
    {
      key: "password",
      label: "Password",
      type: "password",
    },
    {
      key: "dbName",
      label: "Database",
      type: "text",
      required: true,
    },
    {
      key: "useTLS",
      label: "Enable TLS/SSL",
      type: "boolean",
      defaultValue: true,
    },
  ],
};

export class TiDBConnector extends SQLMySQLFamilyBaseConnector {
  constructor() {
    super({
      manifest: TIDB_MANIFEST,
      engineKind: "tidb",
      defaultPort: "4000",
      defaultTLS: true,
    });
  }
}
