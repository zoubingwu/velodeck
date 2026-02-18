import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  ConnectUsingSaved,
  DeleteSavedConnection,
  ListSavedConnections,
} from "@/bridge";
import { useMount } from "ahooks";
import { formatDistanceToNow } from "date-fns";
import { Loader, PlusCircleIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { services } from "@/bridge";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionFormDialog } from "./ConnectionForm";
import SettingsModal from "./SettingModal";

type SavedConnectionsMap = Record<string, services.ConnectionDetails>;

const WelcomeScreen = () => {
  const [savedConnections, setSavedConnections] = useState<SavedConnectionsMap>(
    {},
  );
  const hasConnections = Object.keys(savedConnections).length > 0;
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingConnection, setEditingConnection] = useState<{
    id: string;
    name: string;
    connection: services.ConnectionDetails;
  } | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const connections = await ListSavedConnections();
      setSavedConnections(connections || {});
    } catch (error: any) {
      toast.error("Failed to load saved connections", {
        description: error?.message,
      });
      setSavedConnections({});
    } finally {
      if (isLoadingConnections) setIsLoadingConnections(false);
    }
  }, [isLoadingConnections]);

  useMount(() => {
    fetchConnections();
  });

  const handleConnect = async (connectionId: string) => {
    setConnectingId(connectionId);
    try {
      await ConnectUsingSaved(connectionId);
    } catch (error: any) {
      console.error(`Connect using ${connectionId} error:`, error);
      toast.error("Connection Failed", { description: error?.message });
    } finally {
      setConnectingId(null);
    }
  };

  const handleDelete = async (connectionId: string) => {
    try {
      await DeleteSavedConnection(connectionId);
      const connectionName =
        savedConnections[connectionId]?.name || connectionId;
      toast.success("Connection Deleted", {
        description: `Connection '${connectionName}' was deleted.`,
      });
      fetchConnections();
    } catch (error: any) {
      console.error(`Delete connection ${connectionId} error:`, error);
      toast.error("Delete Failed", { description: error?.message });
    }
  };

  const handleAddNewConnection = () => {
    setIsEditing(false);
    setEditingConnection(null);
    setIsFormOpen(true);
  };

  const handleEdit = (
    connectionId: string,
    details: services.ConnectionDetails,
  ) => {
    setIsEditing(true);
    setEditingConnection({
      id: connectionId,
      name: details.name || "",
      connection: details,
    });
    setIsFormOpen(true);
  };

  const sortedConnections = useMemo(() => {
    return Object.entries(savedConnections).sort(([, a], [, b]) => {
      const timeA = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
      const timeB = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
      return timeB - timeA; // Sort descending (most recent first)
    });
  }, [savedConnections]);

  return (
    <div className="w-full min-h-full bg-muted/50 p-6 md:p-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            Welcome to TiDB Desktop
          </h1>
          <p className="text-muted-foreground">
            Connect and manage your TiDB/MySQL database connections
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleAddNewConnection}>
            <PlusCircleIcon className="mr-2 h-4 w-4" /> Add New Connection
          </Button>

          <Tooltip>
            <SettingsModal>
              <Button variant="outline" className="size-9">
                <SettingsIcon className="h-4 w-4" />
                <span className="sr-only">Preferences</span>
              </Button>
            </SettingsModal>
          </Tooltip>
        </div>
      </header>

      <section>
        {isLoadingConnections ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader className="h-8 w-8 animate-spin mr-3" />
            <span>Loading connections...</span>
          </div>
        ) : hasConnections ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {sortedConnections.map(([connectionId, details]) => (
              <ConnectionCard
                key={connectionId}
                id={connectionId}
                name={details.name || "Unnamed Connection"}
                details={details}
                onConnect={handleConnect}
                onDelete={handleDelete}
                onEdit={handleEdit}
                isConnecting={connectingId === connectionId}
                lastUsed={
                  details.lastUsed
                    ? formatDistanceToNow(new Date(details.lastUsed), {
                        addSuffix: true,
                      })
                    : "Never"
                }
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10 border border-dashed rounded-lg">
            <h3 className="text-lg font-semibold">No Saved Connections</h3>
            <p className="text-muted-foreground mt-1 mb-4">
              Ready to explore? Add your first connection now.
            </p>
            <Button onClick={handleAddNewConnection} variant="outline">
              <PlusCircleIcon className="mr-2 h-4 w-4" />
              Add New Connection
            </Button>
          </div>
        )}
      </section>

      <ConnectionFormDialog
        isOpen={isFormOpen}
        onOpenChange={setIsFormOpen}
        onConnectionSaved={fetchConnections}
        isEditing={isEditing}
        defaultValues={editingConnection}
        savedConnections={savedConnections}
      />
    </div>
  );
};

export default memo(WelcomeScreen);
