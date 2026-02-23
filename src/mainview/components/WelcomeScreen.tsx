import type { ConnectionProfile, ConnectorManifest } from "@shared/contracts";
import { useMount } from "ahooks";
import { formatDistanceToNow } from "date-fns";
import { Loader, PlusCircleIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/bridge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConnectionCard } from "./ConnectionCard";
import { ConnectionFormDialog } from "./ConnectionForm";
import SettingsModal from "./SettingModal";

type SavedConnectionsMap = Record<string, ConnectionProfile>;

interface WelcomeScreenProps {
  onConnected: (profile: ConnectionProfile) => void;
}

const WelcomeScreen = ({ onConnected }: WelcomeScreenProps) => {
  const [savedConnections, setSavedConnections] = useState<SavedConnectionsMap>(
    {},
  );
  const [connectorManifests, setConnectorManifests] = useState<
    ConnectorManifest[]
  >([]);
  const hasConnections = Object.keys(savedConnections).length > 0;
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingConnection, setEditingConnection] = useState<{
    id: string;
    name: string;
    profile: ConnectionProfile;
  } | null>(null);

  const manifestByKind = useMemo(() => {
    const map = new Map<string, ConnectorManifest>();
    for (const manifest of connectorManifests) {
      map.set(manifest.kind, manifest);
    }
    return map;
  }, [connectorManifests]);

  const fetchConnections = useCallback(async () => {
    try {
      const connections = await api.connection.listSavedConnections();
      setSavedConnections(connections || {});
    } catch (error: any) {
      toast.error("Failed to load saved connections", {
        description: error?.message,
      });
      setSavedConnections({});
    } finally {
      setIsLoadingConnections(false);
    }
  }, []);

  const fetchConnectors = useCallback(async () => {
    try {
      const connectors = await api.query.listConnectors();
      setConnectorManifests(connectors || []);
    } catch (error: any) {
      toast.error("Failed to load connectors", {
        description: error?.message,
      });
      setConnectorManifests([]);
    } finally {
      setIsLoadingConnectors(false);
    }
  }, []);

  useMount(() => {
    void fetchConnections();
    void fetchConnectors();
  });

  const handleConnect = async (connectionId: string) => {
    setConnectingId(connectionId);
    try {
      const profile = await api.connection.connectUsingSaved({ connectionId });
      onConnected(profile);
    } catch (error: any) {
      console.error(`Connect using ${connectionId} error:`, error);
      toast.error("Connection Failed", { description: error?.message });
    } finally {
      setConnectingId(null);
    }
  };

  const handleDelete = async (connectionId: string) => {
    try {
      await api.connection.deleteSavedConnection({ connectionId });
      const connectionName =
        savedConnections[connectionId]?.name || connectionId;
      toast.success("Connection Deleted", {
        description: `Connection '${connectionName}' was deleted.`,
      });
      void fetchConnections();
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

  const handleEdit = (connectionId: string, profile: ConnectionProfile) => {
    setIsEditing(true);
    setEditingConnection({
      id: connectionId,
      name: profile.name || "",
      profile,
    });
    setIsFormOpen(true);
  };

  const sortedConnections = useMemo(() => {
    return Object.entries(savedConnections).sort(([, a], [, b]) => {
      const timeA = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
      const timeB = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
      return timeB - timeA;
    });
  }, [savedConnections]);

  const isLoading = isLoadingConnections || isLoadingConnectors;

  return (
    <div className="w-full min-h-full bg-muted/50 p-6 md:p-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            Welcome to VeloDeck
          </h1>
          <p className="text-muted-foreground">
            Connect and browse data across connectors.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleAddNewConnection}
            disabled={isLoadingConnectors}
          >
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
        {isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader className="h-8 w-8 animate-spin mr-3" />
            <span>Loading connections...</span>
          </div>
        ) : hasConnections ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {sortedConnections.map(([connectionId, profile]) => (
              <ConnectionCard
                key={connectionId}
                id={connectionId}
                name={profile.name || "Unnamed Connection"}
                profile={profile}
                connectorLabel={
                  manifestByKind.get(profile.kind)?.label || profile.kind
                }
                onConnect={handleConnect}
                onDelete={handleDelete}
                onEdit={handleEdit}
                isConnecting={connectingId === connectionId}
                lastUsed={
                  profile.lastUsed
                    ? formatDistanceToNow(new Date(profile.lastUsed), {
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
            <Button
              onClick={handleAddNewConnection}
              variant="outline"
              disabled={isLoadingConnectors}
            >
              <PlusCircleIcon className="mr-2 h-4 w-4" />
              Add New Connection
            </Button>
          </div>
        )}
      </section>

      <ConnectionFormDialog
        isOpen={isFormOpen}
        onOpenChange={setIsFormOpen}
        onConnectionSaved={(_id, _profile) => {
          void fetchConnections();
        }}
        isEditing={isEditing}
        defaultValues={editingConnection}
        savedConnections={savedConnections}
        connectorManifests={connectorManifests}
      />
    </div>
  );
};

export default memo(WelcomeScreen);
