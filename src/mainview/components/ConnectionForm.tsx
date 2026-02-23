import type {
  ConnectionProfile,
  ConnectorFormField,
  ConnectorManifest,
} from "@shared/contracts";
import { Loader } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/bridge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ConnectionFormDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionSaved: (id: string, profile: ConnectionProfile) => void;
  defaultValues: {
    id: string;
    name: string;
    profile: ConnectionProfile;
  } | null;
  isEditing?: boolean;
  savedConnections: Record<string, ConnectionProfile>;
  connectorManifests: ConnectorManifest[];
};

const falseyTLSValues = new Set([
  "0",
  "false",
  "no",
  "off",
  "disable",
  "disabled",
  "none",
]);

function createDefaultOptions(
  manifest: ConnectorManifest | undefined,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const field of manifest?.formFields || []) {
    if (field.defaultValue !== undefined) {
      options[field.key] = field.defaultValue;
      continue;
    }

    if (field.type === "boolean") {
      options[field.key] = false;
      continue;
    }

    options[field.key] = "";
  }

  return options;
}

function createDefaultProfile(
  manifests: ConnectorManifest[],
  kind?: string,
): ConnectionProfile {
  const selected =
    manifests.find((item) => item.kind === kind) || manifests[0] || null;

  return {
    kind: selected?.kind || "mysql",
    options: createDefaultOptions(selected || undefined),
  };
}

function readStringOption(
  profile: ConnectionProfile,
  key: string,
  fallback = "",
): string {
  const value = profile.options[key];
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function readBooleanOption(
  profile: ConnectionProfile,
  key: string,
  fallback = false,
): boolean {
  const value = profile.options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function parseConnectionString(connectionString: string): ConnectionProfile {
  const input = connectionString.trim();
  if (!input) {
    throw new Error("Connection string cannot be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(
      "Invalid URL format. Example: mysql://user:password@host:3306/dbname?tls=true",
    );
  }

  const protocol = parsed.protocol.toLowerCase();
  const isMySQL = ["mysql:", "mysql2:"].includes(protocol);
  const isTiDB = protocol === "tidb:";
  const isPostgres = ["postgres:", "postgresql:"].includes(protocol);

  if (!isMySQL && !isTiDB && !isPostgres) {
    throw new Error(
      "Unsupported protocol. Use mysql://, tidb://, postgres://, or postgresql://",
    );
  }

  if (!parsed.hostname) {
    throw new Error("Connection URL must include a host.");
  }

  const tlsRaw =
    parsed.searchParams.get("tls") ??
    parsed.searchParams.get("ssl") ??
    parsed.searchParams.get("ssl-mode") ??
    parsed.searchParams.get("sslmode");

  const tlsValue = tlsRaw?.trim().toLowerCase();
  const useTLS =
    tlsValue === undefined
      ? parsed.hostname.includes(".tidbcloud.com")
      : !falseyTLSValues.has(tlsValue);

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));

  if (isMySQL || isTiDB) {
    return {
      kind: isTiDB ? "tidb" : "mysql",
      options: {
        host: parsed.hostname,
        port: parsed.port || (isTiDB ? "4000" : "3306"),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        dbName,
        useTLS,
      },
    };
  }

  return {
    kind: "postgres",
    options: {
      host: parsed.hostname,
      port: parsed.port || "5432",
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      dbName,
      useTLS,
    },
  };
}

function isImportableKind(kind: string): boolean {
  return kind === "mysql" || kind === "tidb" || kind === "postgres";
}

function shouldRenderField(
  profile: ConnectionProfile,
  field: ConnectorFormField,
): boolean {
  if (field.key === "serviceAccountJson") {
    return (
      readStringOption(
        profile,
        "authType",
        "application_default_credentials",
      ) === "service_account_json"
    );
  }

  if (field.key === "serviceAccountKeyFile") {
    return (
      readStringOption(
        profile,
        "authType",
        "application_default_credentials",
      ) === "service_account_key_file"
    );
  }

  return true;
}

export function ConnectionFormDialog({
  isOpen,
  onOpenChange,
  onConnectionSaved,
  defaultValues,
  isEditing,
  savedConnections,
  connectorManifests,
}: ConnectionFormDialogProps) {
  const initialProfile = useMemo(
    () =>
      defaultValues?.profile ||
      createDefaultProfile(connectorManifests, connectorManifests[0]?.kind),
    [connectorManifests, defaultValues],
  );

  const [formState, setFormState] = useState<ConnectionProfile>(initialProfile);
  const [connectionName, setConnectionName] = useState<string>(
    defaultValues?.name || "",
  );
  const [connectionString, setConnectionString] = useState("");
  const [isImportPopoverOpen, setIsImportPopoverOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const next =
      defaultValues?.profile ||
      createDefaultProfile(connectorManifests, connectorManifests[0]?.kind);

    setFormState(next);
    setConnectionName(defaultValues?.name || "");
    setConnectionString("");
    setIsImportPopoverOpen(false);
    setIsTesting(false);
    setIsSaving(false);
  }, [connectorManifests, defaultValues, isOpen]);

  const selectedManifest = useMemo(
    () =>
      connectorManifests.find((item) => item.kind === formState.kind) ||
      connectorManifests[0] ||
      null,
    [connectorManifests, formState.kind],
  );

  const handleKindChange = (kind: string) => {
    const manifest = connectorManifests.find((item) => item.kind === kind);

    setFormState((prev) => ({
      ...createDefaultProfile(connectorManifests, kind),
      id: prev.id,
      name: prev.name,
      kind,
      options: createDefaultOptions(manifest),
    }));
  };

  const updateOption = (key: string, value: unknown) => {
    setFormState((prev) => ({
      ...prev,
      options: {
        ...prev.options,
        [key]: value,
      },
    }));
  };

  const handleConnectionStringImport = () => {
    try {
      const parsed = parseConnectionString(connectionString);
      const manifest = connectorManifests.find(
        (item) => item.kind === parsed.kind,
      );

      setFormState((prev) => ({
        ...prev,
        kind: parsed.kind,
        options: {
          ...createDefaultOptions(manifest),
          ...parsed.options,
        },
      }));
      setConnectionString("");
      setIsImportPopoverOpen(false);
      toast.success("Connection URL imported", {
        description: "Host, port, user, database, and TLS settings are filled.",
      });
    } catch (error: unknown) {
      toast.error("Invalid Connection URL", {
        description:
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "Could not parse connection URL.",
      });
    }
  };

  const handlePickSQLiteFile = async () => {
    try {
      const selectedPath = await api.window.pickSQLiteFile({
        currentPath: readStringOption(formState, "filePath"),
      });
      if (!selectedPath) {
        return;
      }

      updateOption("filePath", selectedPath);
    } catch (error: unknown) {
      toast.error("Choose File Failed", {
        description:
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "Unable to open file picker.",
      });
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const success = await api.connection.testConnection({
        profile: formState,
      });
      if (success) {
        toast.success("Connection Successful", {
          description: "Successfully connected to the connector.",
        });
      } else {
        toast.error("Connection Test Failed", {
          description: "Could not connect.",
        });
      }
    } catch (error: unknown) {
      toast.error("Connection Test Error", {
        description:
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "An unknown error occurred.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (event?: FormEvent<HTMLFormElement>) => {
    if (event) {
      event.preventDefault();
    }

    const name = connectionName.trim();
    if (!name) {
      toast.error("Missing Connection Name", {
        description: "Please provide a name to save this connection.",
      });
      return;
    }

    setIsSaving(true);
    try {
      const isNameTaken = Object.entries(savedConnections).some(
        ([id, details]) => {
          if (isEditing && defaultValues?.id === id) {
            return false;
          }
          return details.name === name;
        },
      );

      if (isNameTaken) {
        toast.error("Connection Name Already Exists", {
          description: "Please choose a different name.",
        });
        return;
      }

      const profileToSave: ConnectionProfile = {
        ...formState,
        name,
        id: isEditing ? defaultValues?.id || "" : "",
      };

      const savedConnectionId = await api.connection.saveConnection({
        profile: profileToSave,
      });

      toast.success("Connection Saved", {
        description: `Connection '${name}' saved successfully.`,
      });

      onConnectionSaved(savedConnectionId, {
        ...profileToSave,
        id: savedConnectionId,
      });
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error("Save Error", {
        description:
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "Could not save connection.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderField = (field: ConnectorFormField) => {
    if (!shouldRenderField(formState, field)) {
      return null;
    }

    if (field.type === "boolean") {
      return (
        <div key={field.key} className="grid grid-cols-4 items-center gap-4">
          <Label className="text-right">{field.label}</Label>
          <div className="col-span-3 flex items-center gap-2">
            <Checkbox
              checked={readBooleanOption(
                formState,
                field.key,
                Boolean(field.defaultValue),
              )}
              onCheckedChange={(checked) =>
                updateOption(field.key, checked === true)
              }
            />
            {field.description && (
              <span className="text-sm text-muted-foreground">
                {field.description}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.key} className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor={field.key} className="text-right">
            {field.label}
          </Label>
          <select
            id={field.key}
            value={readStringOption(formState, field.key)}
            onChange={(event) => updateOption(field.key, event.target.value)}
            className="col-span-3 h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <div key={field.key} className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor={field.key} className="text-right pt-2">
            {field.label}
          </Label>
          <textarea
            id={field.key}
            value={readStringOption(formState, field.key)}
            onChange={(event) => updateOption(field.key, event.target.value)}
            className="col-span-3 min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={field.placeholder}
          />
        </div>
      );
    }

    if (field.type === "file" && field.key === "filePath") {
      return (
        <div key={field.key} className="grid grid-cols-4 items-start gap-4">
          <Label htmlFor={field.key} className="text-right">
            {field.label}
          </Label>
          <div className="col-span-3 flex items-center gap-2">
            <Input
              id={field.key}
              value={readStringOption(formState, field.key)}
              readOnly
              className="flex-1"
              autoComplete="off"
              placeholder={field.placeholder}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handlePickSQLiteFile}
            >
              Choose File
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div key={field.key} className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={field.key} className="text-right">
          {field.label}
        </Label>
        <Input
          id={field.key}
          type={field.type === "password" ? "password" : "text"}
          value={readStringOption(formState, field.key)}
          onChange={(event) => updateOption(field.key, event.target.value)}
          className="col-span-3"
          autoComplete="off"
          placeholder={field.placeholder}
        />
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? "Edit Connector Connection"
              : "Add Connector Connection"}
          </DialogTitle>
          <DialogDescription>
            Configure and save your connection profile.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="connectionName" className="text-right">
                Name
              </Label>
              <Input
                id="connectionName"
                value={connectionName}
                onChange={(event) => setConnectionName(event.target.value)}
                className="col-span-3"
                placeholder="e.g., Prod PG, Local SQLite"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="connectionKind" className="text-right">
                Type
              </Label>
              <select
                id="connectionKind"
                value={formState.kind}
                onChange={(event) => handleKindChange(event.target.value)}
                className="col-span-3 h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {connectorManifests.map((manifest) => (
                  <option key={manifest.kind} value={manifest.kind}>
                    {manifest.label}
                  </option>
                ))}
              </select>
            </div>

            {(selectedManifest?.formFields || []).map((field) =>
              renderField(field),
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {isImportableKind(formState.kind) ? (
              <Popover
                open={isImportPopoverOpen}
                onOpenChange={setIsImportPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline">
                    Import from URL
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] space-y-3">
                  <Input
                    value={connectionString}
                    onChange={(event) =>
                      setConnectionString(event.target.value)
                    }
                    placeholder="mysql://user:password@host:3306/dbname"
                  />
                  <Button
                    type="button"
                    onClick={handleConnectionStringImport}
                    className="w-full"
                  >
                    Import
                  </Button>
                </PopoverContent>
              </Popover>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving || isTesting}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isSaving || isTesting}
              >
                {isTesting ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
              <Button type="submit" disabled={isSaving || isTesting}>
                {isSaving ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
