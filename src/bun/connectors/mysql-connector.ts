import type { ConnectorManifest } from "../../shared/contracts";
import { SQLMySQLFamilyBaseConnector } from "./sql-mysql-family-base";

const MYSQL_MANIFEST: ConnectorManifest = {
  kind: "mysql",
  label: "MySQL",
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
      placeholder: "127.0.0.1",
    },
    {
      key: "port",
      label: "Port",
      type: "text",
      required: true,
      defaultValue: "3306",
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
      defaultValue: false,
    },
  ],
};

export class MySQLConnector extends SQLMySQLFamilyBaseConnector {
  constructor() {
    super({
      manifest: MYSQL_MANIFEST,
      engineKind: "mysql",
      defaultPort: "3306",
      defaultTLS: false,
    });
  }
}
