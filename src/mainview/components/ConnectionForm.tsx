import { Loader } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { services } from "@/bridge";
import { SaveConnection, TestConnection } from "@/bridge";
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

type ConnectionKind = services.ConnectionDetails["kind"];

type ConnectionFormDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionSaved: (
    id: string,
    connection: services.ConnectionDetails,
  ) => void;
  defaultValues: {
    id: string;
    name: string;
    connection: services.ConnectionDetails;
  } | null;
  isEditing?: boolean;
  savedConnections: Record<string, services.ConnectionDetails>;
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

function createDefaultConnection(
  kind: ConnectionKind,
): services.ConnectionDetails {
  switch (kind) {
    case "mysql":
      return {
        kind,
        host: "",
        port: "4000",
        user: "",
        password: "",
        dbName: "",
        useTLS: true,
      };
    case "postgres":
      return {
        kind,
        host: "",
        port: "5432",
        user: "",
        password: "",
        dbName: "",
        useTLS: false,
      };
    case "sqlite":
      return {
        kind,
        filePath: "",
        readOnly: false,
        attachedDatabases: [],
      };
    case "bigquery":
      return {
        kind,
        projectId: "",
        location: "US",
        authType: "application_default_credentials",
      };
    default:
      return {
        kind: "mysql",
        host: "",
        port: "4000",
        user: "",
        password: "",
        dbName: "",
        useTLS: true,
      };
  }
}

function parseConnectionString(
  connectionString: string,
): services.ConnectionDetails {
  const input = connectionString.trim();
  if (!input) {
    throw new Error("Connection string cannot be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(
      "Invalid URL format. Example: mysql://user:password@host:4000/dbname?tls=true",
    );
  }

  const protocol = parsed.protocol.toLowerCase();
  const isMySQL = ["mysql:", "mysql2:", "tidb:"].includes(protocol);
  const isPostgres = ["postgres:", "postgresql:"].includes(protocol);

  if (!isMySQL && !isPostgres) {
    throw new Error(
      "Unsupported protocol. Use mysql://, mysql2://, tidb://, postgres://, or postgresql://",
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

  if (isMySQL) {
    return {
      kind: "mysql",
      host: parsed.hostname,
      port: parsed.port || "4000",
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      dbName,
      useTLS,
    };
  }

  return {
    kind: "postgres",
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    dbName,
    useTLS,
  };
}

function isHostConnection(
  connection: services.ConnectionDetails,
): connection is Extract<
  services.ConnectionDetails,
  { kind: "mysql" | "postgres" }
> {
  return connection.kind === "mysql" || connection.kind === "postgres";
}

export function ConnectionFormDialog({
  isOpen,
  onOpenChange,
  onConnectionSaved,
  defaultValues,
  isEditing,
  savedConnections,
}: ConnectionFormDialogProps) {
  const initialConnection = useMemo(
    () => defaultValues?.connection || createDefaultConnection("mysql"),
    [defaultValues],
  );

  const [formState, setFormState] =
    useState<services.ConnectionDetails>(initialConnection);
  const [connectionName, setConnectionName] = useState<string>(
    defaultValues?.name || "",
  );
  const [connectionString, setConnectionString] = useState("");
  const [isImportPopoverOpen, setIsImportPopoverOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormState(
        defaultValues?.connection || createDefaultConnection("mysql"),
      );
      setConnectionName(defaultValues?.name || "");
      setConnectionString("");
      setIsImportPopoverOpen(false);
      setIsTesting(false);
      setIsSaving(false);
    }
  }, [isOpen, defaultValues]);

  const handleKindChange = (kind: ConnectionKind) => {
    setFormState((prev) => {
      if (prev.kind === kind) {
        return prev;
      }
      const base = createDefaultConnection(kind);
      return {
        ...base,
        id: prev.id,
        name: prev.name,
      } as services.ConnectionDetails;
    });
  };

  const updateFormState = (patch: Partial<services.ConnectionDetails>) => {
    setFormState(
      (prev) =>
        ({
          ...prev,
          ...patch,
        }) as services.ConnectionDetails,
    );
  };

  const handleConnectionStringImport = () => {
    try {
      const parsed = parseConnectionString(connectionString);
      setFormState(
        (prev) =>
          ({
            ...parsed,
            id: prev.id,
            name: prev.name,
          }) as services.ConnectionDetails,
      );
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

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const success = await TestConnection(formState);
      if (success) {
        toast.success("Connection Successful", {
          description: "Successfully connected to the database.",
        });
      } else {
        toast.error("Connection Test Failed", {
          description: "Could not connect to the database.",
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

      const connectionToSave: services.ConnectionDetails = {
        ...formState,
        name,
        id: isEditing ? defaultValues?.id || "" : "",
      };

      const savedConnectionId = await SaveConnection(connectionToSave);

      toast.success("Connection Saved", {
        description: `Connection '${name}' saved successfully.`,
      });

      onConnectionSaved(savedConnectionId, {
        ...connectionToSave,
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

  const renderDriverSpecificFields = () => {
    if (isHostConnection(formState)) {
      return (
        <>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="host" className="text-right">
              Host
            </Label>
            <Input
              id="host"
              value={formState.host}
              onChange={(e) => updateFormState({ host: e.target.value })}
              className="col-span-3"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right">
              Port
            </Label>
            <Input
              id="port"
              value={formState.port}
              onChange={(e) => updateFormState({ port: e.target.value })}
              className="col-span-3"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="user" className="text-right">
              User
            </Label>
            <Input
              id="user"
              value={formState.user}
              onChange={(e) => updateFormState({ user: e.target.value })}
              className="col-span-3"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={formState.password}
              onChange={(e) => updateFormState({ password: e.target.value })}
              className="col-span-3"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="dbName" className="text-right">
              Database
            </Label>
            <Input
              id="dbName"
              value={formState.dbName}
              onChange={(e) => updateFormState({ dbName: e.target.value })}
              className="col-span-3"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">TLS</Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                checked={formState.useTLS}
                onCheckedChange={(checked) =>
                  updateFormState({ useTLS: checked === true })
                }
              />
              <span className="text-sm text-muted-foreground">
                Enable TLS/SSL
              </span>
            </div>
          </div>
        </>
      );
    }

    if (formState.kind === "sqlite") {
      return (
        <>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="filePath" className="text-right">
              File Path
            </Label>
            <Input
              id="filePath"
              value={formState.filePath}
              onChange={(e) => updateFormState({ filePath: e.target.value })}
              className="col-span-3"
              autoComplete="off"
              placeholder="/path/to/database.sqlite"
            />
          </div>
        </>
      );
    }

    return (
      <>
        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="projectId" className="text-right">
            Project ID
          </Label>
          <Input
            id="projectId"
            value={formState.projectId}
            onChange={(e) => updateFormState({ projectId: e.target.value })}
            className="col-span-3"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="location" className="text-right">
            Location
          </Label>
          <Input
            id="location"
            value={formState.location || ""}
            onChange={(e) => updateFormState({ location: e.target.value })}
            className="col-span-3"
            autoComplete="off"
            placeholder="US"
          />
        </div>

        <div className="grid grid-cols-4 items-center gap-4">
          <Label htmlFor="authType" className="text-right">
            Auth Type
          </Label>
          <select
            id="authType"
            value={formState.authType}
            onChange={(e) =>
              updateFormState({
                authType: e.target.value as typeof formState.authType,
              })
            }
            className="col-span-3 h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="application_default_credentials">ADC</option>
            <option value="service_account_json">Service Account JSON</option>
            <option value="service_account_key_file">
              Service Account Key File
            </option>
          </select>
        </div>

        {formState.authType === "service_account_json" && (
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="serviceAccountJson" className="text-right pt-2">
              SA JSON
            </Label>
            <textarea
              id="serviceAccountJson"
              value={formState.serviceAccountJson || ""}
              onChange={(e) =>
                updateFormState({ serviceAccountJson: e.target.value })
              }
              className="col-span-3 min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Paste service account key JSON"
            />
          </div>
        )}

        {formState.authType === "service_account_key_file" && (
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="serviceAccountKeyFile" className="text-right">
              Key File
            </Label>
            <Input
              id="serviceAccountKeyFile"
              value={formState.serviceAccountKeyFile || ""}
              onChange={(e) =>
                updateFormState({ serviceAccountKeyFile: e.target.value })
              }
              className="col-span-3"
              autoComplete="off"
              placeholder="/path/to/service-account.json"
            />
          </div>
        )}
      </>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Database Connection" : "Add Database Connection"}
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
                onChange={(e) => setConnectionName(e.target.value)}
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
                onChange={(e) =>
                  handleKindChange(e.target.value as ConnectionKind)
                }
                className="col-span-3 h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="mysql">MySQL / TiDB</option>
                <option value="postgres">PostgreSQL</option>
                <option value="sqlite">SQLite</option>
                <option value="bigquery">BigQuery</option>
              </select>
            </div>

            {renderDriverSpecificFields()}
          </div>

          <DialogFooter className="sm:justify-between">
            {formState.kind === "mysql" || formState.kind === "postgres" ? (
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
                    onChange={(e) => setConnectionString(e.target.value)}
                    placeholder="mysql://user:password@host:4000/dbname"
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
