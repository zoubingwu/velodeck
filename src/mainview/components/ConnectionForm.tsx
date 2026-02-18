import { Loader } from "lucide-react";
import React, { FormEvent, useEffect, useState } from "react";
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

// Type definition for the connection details state
type ConnectionFormState = Pick<
  services.ConnectionDetails,
  "host" | "port" | "user" | "password" | "dbName" | "useTLS"
>;

const initialFormState: ConnectionFormState = {
  host: "",
  port: "4000", // Default TiDB port
  user: "",
  password: "",
  dbName: "",
  useTLS: true,
};

// Add props to control open state and notify on save
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
    connection: ConnectionFormState;
  } | null;
  isEditing?: boolean;
  savedConnections: Record<string, services.ConnectionDetails>; // key is now connection ID
};

export function ConnectionFormDialog({
  isOpen,
  onOpenChange,
  onConnectionSaved,
  defaultValues,
  isEditing,
  savedConnections,
}: ConnectionFormDialogProps) {
  const [formState, setFormState] = useState<ConnectionFormState>(
    defaultValues?.connection || initialFormState,
  );
  const [connectionName, setConnectionName] = useState<string>(
    defaultValues?.name || "",
  );
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormState(defaultValues?.connection || initialFormState);
      setConnectionName(defaultValues?.name || "");
      setIsTesting(false);
      setIsSaving(false);
    }
  }, [isOpen, defaultValues]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    // Handle checkbox separately
    if (type === "checkbox" && e.target instanceof HTMLInputElement) {
      // Cast target to HTMLInputElement after the type guard
      const inputElement = e.target as HTMLInputElement;
      setFormState((prev) => ({ ...prev, [name]: inputElement.checked }));
    } else {
      setFormState((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConnectionName(e.target.value);
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
          description: "Could not ping the database.",
        });
      }
    } catch (error: any) {
      console.error("Test Connection Error:", error);
      toast.error("Connection Test Error", {
        description:
          typeof error === "string"
            ? error
            : error?.message || "An unknown error occurred.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (event?: FormEvent<HTMLFormElement>) => {
    // Prevent default form submission if called from onSubmit
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
      // Check for name conflicts only with other connections (not the one being edited)
      const isNameTaken = Object.entries(savedConnections).some(
        ([id, details]) => {
          if (isEditing && defaultValues?.id === id) {
            return false; // Skip the connection being edited
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

      // Prepare connection details to save
      const connectionToSave: services.ConnectionDetails = {
        ...formState,
        name: name,
        id: isEditing ? defaultValues?.id || "" : "", // Use existing ID if editing, empty for new
      };

      // SaveConnection now handles everything - no need to manually delete
      const savedConnectionId = await SaveConnection(connectionToSave);

      toast.success("Connection Saved", {
        description: `Connection '${name}' saved successfully.`,
      });

      onConnectionSaved(savedConnectionId, {
        ...connectionToSave,
        id: savedConnectionId,
      });
      onOpenChange(false);
    } catch (error: any) {
      toast.error("Save Error", {
        description:
          typeof error === "string"
            ? error
            : error?.message || "Could not save connection.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Database Connection" : "Add Database Connection"}
          </DialogTitle>
          <DialogDescription>
            Enter details to connect. Provide a name to save the connection for
            later use.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave}>
          <div className="grid gap-4 py-4">
            {/* Connection Name Input */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="connectionName" className="text-right">
                Name
              </Label>
              <Input
                id="connectionName"
                name="connectionName"
                value={connectionName}
                onChange={handleNameChange}
                className="col-span-3"
                placeholder="e.g., My TiDB Cloud Dev, Local Test"
                autoComplete="off"
                autoCorrect="off"
              />
            </div>
            {/* Host */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="host" className="text-right">
                Host
              </Label>
              <Input
                id="host"
                name="host"
                value={formState.host}
                onChange={handleChange}
                className="col-span-3"
                placeholder="e.g., gateway01.us-east-1.prod.aws.tidbcloud.com"
              />
            </div>
            {/* Port */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="port" className="text-right">
                Port
              </Label>
              <Input
                id="port"
                name="port"
                type="number"
                value={formState.port}
                onChange={handleChange}
                className="col-span-3"
                placeholder="e.g., 4000"
              />
            </div>
            {/* User */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="user" className="text-right">
                User
              </Label>
              <Input
                id="user"
                name="user"
                value={formState.user}
                onChange={handleChange}
                className="col-span-3"
                placeholder="e.g., root or your_db_user"
              />
            </div>
            {/* Password */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="password" className="text-right">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formState.password}
                onChange={handleChange}
                className="col-span-3"
              />
            </div>
            {/* Database Name */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="dbName" className="text-right">
                Database
              </Label>
              <Input
                id="dbName"
                name="dbName"
                value={formState.dbName}
                onChange={handleChange}
                className="col-span-3"
                placeholder="Optional, e.g., test"
              />
            </div>
            {/* Use TLS Checkbox - Note: Go backend auto-detects for .tidbcloud.com */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="useTLS" className="text-right">
                Use TLS
              </Label>
              <div className="col-span-3 flex items-center space-x-2">
                <Checkbox
                  id="useTLS"
                  name="useTLS"
                  checked={formState.useTLS}
                  onCheckedChange={(checked) =>
                    setFormState((prev) => ({ ...prev, useTLS: !!checked }))
                  }
                />
                <label
                  htmlFor="useTLS"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground"
                >
                  Force TLS, required for TiDB Cloud
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="secondary"
                onClick={handleTestConnection}
                disabled={isTesting || isSaving || !formState.host}
              >
                {isTesting && <Loader className="h-4 w-4 animate-spin" />}
                {isTesting ? "Testing..." : "Test"}
              </Button>
              <Button
                type="submit"
                disabled={isTesting || isSaving || !connectionName.trim()}
              >
                {isSaving && <Loader className="h-4 w-4 animate-spin" />}
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
