import { type ClassValue, clsx } from "clsx";
import {
  CalendarDays, // For 'date'
  Hash, // For 'number'
  List, // For 'option' (assuming single choice)
  ListChecks, // For 'multiOption' (assuming multiple choices)
  LucideIcon, // Base type for icons
  Text, // For 'text'
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import { ColumnDataType } from "./filters";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ColumnDataTypeIcons: Record<ColumnDataType, LucideIcon> = {
  number: Hash,
  date: CalendarDays,
  text: Text,
  option: List,
  multiOption: ListChecks,
};

/**
 * Maps common TiDB/MySQL column type strings to the ColumnDataType used by the filter UI.
 *
 * @param dbType The raw database column type string (e.g., "VARCHAR", "INT", "TIMESTAMP").
 * @returns The corresponding ColumnDataType ('text', 'number', 'date', 'option', 'multiOption').
 */
export function mapDbColumnTypeToFilterType(dbType: string): ColumnDataType {
  const normalizedType = dbType.toUpperCase().split("(")[0].trim(); // Get base type, ignore length/precision

  switch (normalizedType) {
    // Number Types
    case "INT":
    case "INTEGER":
    case "BIGINT":
    case "SMALLINT":
    case "TINYINT":
    case "MEDIUMINT":
    case "FLOAT":
    case "DOUBLE":
    case "DECIMAL":
    case "NUMERIC":
    case "BIT":
      return "number";

    // Date/Time Types
    case "DATE":
    case "DATETIME":
    case "TIMESTAMP":
    case "TIME":
    case "YEAR":
      return "date";

    // Potential Option Types (can be treated as text by default if options aren't fetched)
    case "ENUM":
      // You might map this to 'option' if you intend to fetch enum values later
      // For simple text filtering, 'text' is safer initially.
      return "text";
    case "SET":
      // You might map this to 'multiOption' if you intend to fetch set values later
      return "text";

    // Default to Text (covers VARCHAR, CHAR, TEXT, JSON, BLOB, etc.)
    case "VARCHAR":
    case "CHAR":
    case "TEXT":
    case "TINYTEXT":
    case "MEDIUMTEXT":
    case "LONGTEXT":
    case "JSON":
    case "BLOB":
    case "TINYBLOB":
    case "MEDIUMBLOB":
    case "LONGBLOB":
    case "BINARY":
    case "VARBINARY":
    default:
      return "text";
  }
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function isSystemDatabase(dbName: string): boolean {
  const systemDatabases = [
    "mysql",
    "information_schema",
    "performance_schema",
    "metrics_schema",
    "sys",
    "lightning_task_info",
  ];
  return systemDatabases.includes(dbName.toLowerCase());
}
