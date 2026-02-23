import type { ConnectionProfile } from "@shared/contracts";
import { Clock, Database, Loader, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ConnectionCardProps = {
  id: string;
  name: string;
  profile: ConnectionProfile;
  connectorLabel: string;
  onConnect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, profile: ConnectionProfile) => void;
  isConnecting: boolean;
  lastUsed: string;
};

function readOption(options: Record<string, unknown>, key: string): string {
  const value = options[key];
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function connectionSummary(profile: ConnectionProfile): string {
  const options = profile.options;
  const host = readOption(options, "host");
  const port = readOption(options, "port");
  const user = readOption(options, "user");
  const filePath = readOption(options, "filePath");
  const projectId = readOption(options, "projectId");

  if (host || port) {
    const endpoint = [host, port].filter((item) => item).join(":");
    if (user) {
      return `${endpoint} (${user})`;
    }
    return endpoint;
  }

  if (filePath) {
    return filePath;
  }

  if (projectId) {
    return projectId;
  }

  return profile.kind;
}

export const ConnectionCard = ({
  id,
  name,
  profile,
  connectorLabel,
  onConnect,
  onDelete,
  onEdit,
  isConnecting,
  lastUsed,
}: ConnectionCardProps) => {
  const [isDeleting, setIsDeleting] = useState(false);

  const summary = useMemo(() => connectionSummary(profile), [profile]);

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await onDelete(id);
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenEditForm = () => {
    onEdit(id, profile);
  };

  return (
    <Card className="flex flex-col justify-between h-full shadow-sm hover:shadow-md transition-shadow duration-200 gap-4">
      <CardHeader className="">
        <div className="space-y-1 min-w-0">
          <CardTitle className="text-lg break-words">{name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 shrink-0" />
          <span className="truncate">{summary}</span>
        </div>
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 shrink-0" />
          <span className="truncate">{connectorLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          <span>Last used: {lastUsed}</span>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2">
        <Button
          onClick={() => onConnect(id)}
          disabled={isConnecting || isDeleting}
          className="flex-grow"
        >
          {isConnecting ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            <>Connect</>
          )}
        </Button>

        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={isConnecting || isDeleting}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">More options for {name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={handleOpenEditForm}
                disabled={isConnecting || isDeleting}
              >
                Edit
              </DropdownMenuItem>

              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  disabled={isConnecting || isDeleting}
                >
                  Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. Delete connection '{name}'?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting && <Loader className="h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
};
