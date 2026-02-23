import type {
  ConnectionProfile,
  ConnectorCapabilities,
  DataEntityRef,
  EntityDataPage,
  ExplorerNode,
  ServerSideFilter,
} from "@shared/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type CellContext,
  type ColumnDef,
  getCoreRowModel,
  getPaginationRowModel,
  type PaginationState,
  type Table as ReactTable,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import { useLocalStorageState, useMemoizedFn } from "ahooks";
import { Allotment as ReactSplitView } from "allotment";
import { api, onEvent } from "@/bridge";
import { AIPanel } from "@/components/AIPanel";
import { DatabaseTree, type ExplorerTreeNode } from "@/components/DatabaseTree";
import { DataTablePagination } from "@/components/DataTablePagination";
import { Button } from "@/components/ui/button";
import {
  DataTableFilter,
  type ServerSideFilter as FilterControlValue,
} from "@/components/ui/data-table-filter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { filterFn } from "@/lib/filters";
import { ColumnDataTypeIcons, mapDbColumnTypeToFilterType } from "@/lib/utils";
import "allotment/dist/style.css";
import { Loader, SettingsIcon, SparkleIcon, UnplugIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useImmer } from "use-immer";
import DataTable from "./DataTable";
import SettingsModal from "./SettingModal";
import TablePlaceholder from "./TablePlaceHolder";

type TableRowData = Record<string, any>;

type TableState = {
  pageSize: number;
  pageIndex: number;
  serverFilters: ServerSideFilter[];
};

const defaultPageSize = 50;
const defaultTableState: TableState = {
  pageSize: defaultPageSize,
  pageIndex: 0,
  serverFilters: [],
};

const DEFAULT_DB_TREE_WIDTH = 240;
const DEFAULT_AI_PANEL_WIDTH = 300;

const LAYOUT_DB_TREE_WIDTH_KEY = "layout:dbTreeWidth";
const LAYOUT_AI_PANEL_WIDTH_KEY = "layout:aiPanelWidth";
const LAYOUT_AI_PANEL_VISIBLE_KEY = "layout:aiPanelVisible";

const ROOT_PARENT_KEY = "__root__";

function connectorKindLabel(kind?: string): string {
  if (!kind) {
    return "Database";
  }

  return kind
    .split(/[-_]/g)
    .filter((item) => item.length > 0)
    .map((item) => item[0].toUpperCase() + item.slice(1))
    .join(" ");
}

function normalizeExplorerNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return [...nodes].sort((a, b) => {
    if (a.expandable && !b.expandable) {
      return -1;
    }
    if (!a.expandable && b.expandable) {
      return 1;
    }
    return a.label.localeCompare(b.label);
  });
}

function toTreeNodes(
  parentKey: string,
  childrenByParent: Record<string, ExplorerNode[]>,
  loadingParents: Record<string, boolean>,
): ExplorerTreeNode[] {
  const children = childrenByParent[parentKey] || [];

  return children.map((node) => ({
    nodeId: node.nodeId,
    label: node.label,
    expandable: node.expandable,
    isLoadingChildren: !!loadingParents[node.nodeId],
    entityRef: node.entityRef
      ? {
          ...node.entityRef,
          nodeId: node.nodeId,
        }
      : undefined,
    children: node.expandable
      ? toTreeNodes(node.nodeId, childrenByParent, loadingParents)
      : [],
  }));
}

function entityTitle(entity: DataEntityRef | null): string {
  if (!entity) {
    return "";
  }

  if (entity.namespace) {
    return `${entity.namespace}.${entity.name}`;
  }

  return entity.name;
}

const MainDataView = ({
  onClose,
  connectionProfile,
}: {
  onClose: () => void;
  connectionProfile: ConnectionProfile | null;
}) => {
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [tableState, setTableState] = useImmer<TableState>(defaultTableState);
  const [selectedEntity, setSelectedEntity] = useState<DataEntityRef | null>(
    null,
  );
  const [selectedEntityNodeId, setSelectedEntityNodeId] = useState("");
  const [childrenByParent, setChildrenByParent] = useImmer<
    Record<string, ExplorerNode[]>
  >({
    [ROOT_PARENT_KEY]: [],
  });
  const [loadingParents, setLoadingParents] = useImmer<Record<string, boolean>>(
    {},
  );
  const [treeLoadError, setTreeLoadError] = useState<Error | null>(null);

  const currentPageSize = tableState.pageSize;
  const currentPageIndex = tableState.pageIndex;
  const currentServerFilters = tableState.serverFilters;

  const appendActivityLog = useMemoizedFn((log: string) => {
    setActivityLog((prev) => [...prev, log]);
  });

  const [dbTreeWidth, setDbTreeWidth] = useLocalStorageState<number>(
    LAYOUT_DB_TREE_WIDTH_KEY,
    {
      defaultValue: DEFAULT_DB_TREE_WIDTH,
    },
  );

  const [aiPanelWidth, setAiPanelWidth] = useLocalStorageState<number>(
    LAYOUT_AI_PANEL_WIDTH_KEY,
    {
      defaultValue: DEFAULT_AI_PANEL_WIDTH,
    },
  );

  const [showAIPanel, setShowAIPanel] = useLocalStorageState<boolean>(
    LAYOUT_AI_PANEL_VISIBLE_KEY,
    {
      defaultValue: false,
    },
  );

  const loadedParentRef = useRef(new Set<string>());

  const { data: connectionCapabilities } = useQuery<
    ConnectorCapabilities,
    Error
  >({
    queryKey: ["connectionCapabilities", connectionProfile?.id],
    queryFn: () => api.connection.getConnectionCapabilities(),
    enabled: Boolean(connectionProfile?.id),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const {
    data: rootNodesData,
    isLoading: isLoadingRootNodes,
    error: rootNodesError,
  } = useQuery<ExplorerNode[], Error>({
    queryKey: ["explorer", "root", connectionProfile?.id],
    queryFn: () => api.query.listExplorerNodes({ parentNodeId: null }),
    enabled: Boolean(connectionProfile?.id),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const normalizedRootNodes = useMemo(
    () => normalizeExplorerNodes(rootNodesData || []),
    [rootNodesData],
  );
  const rootNodeIdsKey = useMemo(
    () =>
      normalizedRootNodes
        .map(
          (node) => `${node.nodeId}:${node.label}:${node.expandable ? 1 : 0}`,
        )
        .join("|"),
    [normalizedRootNodes],
  );

  const loadChildren = useMemoizedFn(async (parentNodeId: string) => {
    if (loadedParentRef.current.has(parentNodeId)) {
      return;
    }

    setLoadingParents((draft) => {
      draft[parentNodeId] = true;
    });

    try {
      const children = await api.query.listExplorerNodes({ parentNodeId });
      const sorted = normalizeExplorerNodes(children);
      setChildrenByParent((draft) => {
        draft[parentNodeId] = sorted;
      });
      loadedParentRef.current.add(parentNodeId);
      setTreeLoadError(null);
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error ?? "unknown"));
      setTreeLoadError(normalized);
      appendActivityLog(`Explorer load failed: ${normalized.message}`);
    } finally {
      setLoadingParents((draft) => {
        draft[parentNodeId] = false;
      });
    }
  });

  useEffect(() => {
    setChildrenByParent((draft) => {
      draft[ROOT_PARENT_KEY] = normalizedRootNodes;
    });

    loadedParentRef.current.clear();
    loadedParentRef.current.add(ROOT_PARENT_KEY);

    for (const node of normalizedRootNodes) {
      if (node.expandable) {
        void loadChildren(node.nodeId);
      }
    }
  }, [loadChildren, rootNodeIdsKey]);

  const indexStartedRef = useRef(false);
  const triggerIndexer = useMemoizedFn(
    (force: boolean, scopeNodeId?: string) => {
      if (indexStartedRef.current && !force) {
        return;
      }
      indexStartedRef.current = true;

      appendActivityLog("Indexing metadata...");
      const connectionId = connectionProfile?.id;
      if (!connectionId) {
        appendActivityLog("Indexing skipped: no active connection.");
        return;
      }

      void api.metadata
        .extractConnectionMetadata({
          connectionId,
          force,
          scopeNodeId: scopeNodeId ?? "",
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error ?? "unknown");
          appendActivityLog(`Indexing metadata failed: ${message}`);
        });
    },
  );

  useEffect(() => {
    const cleanupFailed = onEvent("metadata:extraction:failed", (payload) => {
      const error =
        typeof payload === "string"
          ? payload
          : String(payload ?? "unknown error");
      appendActivityLog(`Indexing metadata failed: ${error}`);
    });

    const cleanupCompleted = onEvent(
      "metadata:extraction:completed",
      async (metadata) => {
        appendActivityLog("Indexing metadata completed.");
        const kindLabel = connectorKindLabel(connectionProfile?.kind);
        const versionLabel = metadata.version ? ` ${metadata.version}` : "";
        appendActivityLog(`Connected to ${kindLabel}${versionLabel}`);
      },
    );

    triggerIndexer(false);

    return () => {
      cleanupFailed();
      cleanupCompleted();
    };
  }, [appendActivityLog, connectionProfile?.kind, triggerIndexer]);

  const { data: entityData, isFetching: isFetchingEntityData } = useQuery<
    EntityDataPage,
    Error
  >({
    enabled: Boolean(selectedEntity),
    queryKey: [
      "entityData",
      selectedEntity,
      currentPageSize,
      currentPageIndex,
      currentServerFilters,
    ],
    queryFn: async () => {
      if (!selectedEntity) {
        throw new Error("entity selection is required");
      }

      const titleTarget = entityTitle(selectedEntity);

      try {
        appendActivityLog(`Fetching data from ${titleTarget}...`);
        const res = await api.query.readEntity({
          entity: selectedEntity,
          limit: currentPageSize,
          offset: currentPageIndex * currentPageSize,
          filters:
            connectionCapabilities?.supportsServerSideFilter === false
              ? []
              : currentServerFilters,
        });
        appendActivityLog(`Fetched data from ${titleTarget}`);
        return res;
      } catch (error: unknown) {
        appendActivityLog(
          `Error fetching ${titleTarget}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        toast.error("Error fetching entity data", {
          description:
            error instanceof Error ? error.message : String(error ?? "unknown"),
        });
        throw error;
      }
    },
    placeholderData: keepPreviousData,
  });

  const handleFilterChange = useMemoizedFn((filters: FilterControlValue[]) => {
    if (connectionCapabilities?.supportsServerSideFilter === false) {
      return;
    }

    setTableState((draft) => {
      draft.serverFilters = filters;
      draft.pageIndex = 0;
    });
  });

  const columns = useMemo<ColumnDef<TableRowData>[]>(() => {
    const renderCell = (info: CellContext<TableRowData, unknown>) => {
      const value = info.getValue();
      if (value === null || value === undefined) {
        return <span className="text-muted-foreground italic">NULL</span>;
      }
      if (value === "") {
        return <span className="text-muted-foreground italic">EMPTY</span>;
      }
      return String(value).slice(0, 10000);
    };

    if (!entityData?.fields) {
      return [];
    }

    return entityData.fields.map((field): ColumnDef<TableRowData> => {
      const type = mapDbColumnTypeToFilterType(field.type);
      return {
        accessorKey: field.name,
        header: field.name,
        cell: renderCell,
        filterFn: filterFn(type),
        meta: {
          displayName: field.name,
          type,
          icon: ColumnDataTypeIcons[type],
        },
      };
    });
  }, [entityData?.fields]);

  const totalRowCount = entityData?.totalRows;

  const pagination = useMemo(
    () => ({
      pageIndex: currentPageIndex,
      pageSize: currentPageSize,
    }),
    [currentPageIndex, currentPageSize],
  );

  const pageCount = useMemo(() => {
    if (totalRowCount != null && totalRowCount >= 0) {
      return Math.ceil(totalRowCount / currentPageSize);
    }
    return -1;
  }, [totalRowCount, currentPageSize]);

  const tableViewState = (() => {
    if (isLoadingRootNodes) {
      return "init";
    }

    if (isFetchingEntityData) {
      return "loading";
    }

    if (selectedEntity && entityData?.fields?.length) {
      return "data";
    }

    return "empty";
  })();

  const handleSelectEntity = useMemoizedFn((entity: DataEntityRef) => {
    setSelectedEntity(entity);
    setSelectedEntityNodeId(entity.nodeId || "");

    setTableState((draft) => {
      draft.serverFilters = [];
      draft.pageIndex = 0;
    });
  });

  const handleExpandNode = useMemoizedFn((nodeId: string) => {
    void loadChildren(nodeId);
  });

  const handlePaginationChange = useMemoizedFn(
    (updaterOrValue: Updater<PaginationState>) => {
      const nextPagination =
        typeof updaterOrValue === "function"
          ? updaterOrValue(pagination)
          : updaterOrValue;

      setTableState((draft) => {
        draft.pageIndex = nextPagination.pageIndex;
        draft.pageSize = nextPagination.pageSize;
      });
    },
  );

  const data = useMemo(() => entityData?.rows ?? [], [entityData]);

  const table: ReactTable<TableRowData> = useReactTable({
    data,
    columns,
    state: {
      pagination,
    },
    manualPagination: true,
    manualFiltering: true,
    pageCount,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    defaultColumn: {
      minSize: 0,
      size: Number.MAX_SAFE_INTEGER,
      maxSize: Number.MAX_SAFE_INTEGER,
    },
  });

  const rootTreeNodes = useMemo(
    () => toTreeNodes(ROOT_PARENT_KEY, childrenByParent, loadingParents),
    [childrenByParent, loadingParents],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0">
        <ReactSplitView
          key="outer-split"
          defaultSizes={[dbTreeWidth!, window.innerWidth - dbTreeWidth!]}
          separator={false}
          onChange={(sizes: number[]) => {
            if (sizes.length > 0 && sizes[0] > 50) {
              setDbTreeWidth(sizes[0]);
            }
          }}
        >
          <ReactSplitView.Pane
            minSize={DEFAULT_DB_TREE_WIDTH / 2}
            maxSize={DEFAULT_DB_TREE_WIDTH * 2}
          >
            <DatabaseTree
              rootNodes={rootTreeNodes}
              isLoading={isLoadingRootNodes && rootTreeNodes.length === 0}
              loadError={rootNodesError || treeLoadError}
              onExpandNode={handleExpandNode}
              onSelectEntity={handleSelectEntity}
              selectedEntityNodeId={selectedEntityNodeId}
            />
          </ReactSplitView.Pane>

          <ReactSplitView.Pane className="flex flex-col overflow-hidden">
            <ReactSplitView
              key="inner-split"
              defaultSizes={[
                window.innerWidth - dbTreeWidth! - aiPanelWidth!,
                aiPanelWidth ?? DEFAULT_AI_PANEL_WIDTH,
              ]}
              separator={false}
              onChange={(sizes: number[]) => {
                if (showAIPanel && sizes.length === 2 && sizes[1] > 50) {
                  setAiPanelWidth(sizes[1]);
                }
              }}
            >
              <ReactSplitView.Pane minSize={200} className="min-h-0">
                {tableViewState === "data" ? (
                  <DataTable<TableRowData> table={table} />
                ) : (
                  <TablePlaceholder animate={tableViewState === "loading"} />
                )}
              </ReactSplitView.Pane>

              <ReactSplitView.Pane
                visible={showAIPanel}
                minSize={DEFAULT_AI_PANEL_WIDTH / 2}
                preferredSize={aiPanelWidth ?? DEFAULT_AI_PANEL_WIDTH}
                maxSize={DEFAULT_AI_PANEL_WIDTH * 2}
              >
                <AIPanel opened={showAIPanel} />
              </ReactSplitView.Pane>
            </ReactSplitView>
          </ReactSplitView.Pane>
        </ReactSplitView>
      </div>

      <TooltipProvider delayDuration={0}>
        <div className="flex items-center justify-between px-2 py-0 bg-[var(--card)] gap-2 border-t border-[var(--muted)]/10">
          <div className="flex text-xs gap-1 items-center flex-1 min-w-0">
            {tableViewState === "loading" && (
              <Loader className="size-3 animate-spin mr-1" />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="relative top-[1px] truncate block"
                  style={{ maxWidth: "100%" }}
                >
                  {activityLog.length > 0
                    ? activityLog[activityLog.length - 1]
                    : "Ready"}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="max-h-60 w-auto max-w-lg overflow-y-auto rounded-md text-xs force-select-text">
                  {activityLog.length > 0 ? (
                    activityLog.map((log, index) => (
                      <p key={index} className="whitespace-pre-wrap">
                        {log}
                      </p>
                    ))
                  ) : (
                    <p>No activity yet.</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex flex-nowrap items-center gap-2">
            <DataTablePagination
              table={table}
              totalRowCount={totalRowCount}
              disabled={tableViewState !== "data"}
              loading={tableViewState === "loading"}
            />

            <div className="flex gap-2">
              {connectionCapabilities?.supportsServerSideFilter !== false && (
                <Tooltip>
                  <DataTableFilter
                    table={table}
                    onChange={handleFilterChange}
                    disabled={tableViewState !== "data"}
                  />
                  <TooltipContent>
                    <p>Filter</p>
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowAIPanel(!showAIPanel)}
                  >
                    <SparkleIcon className="size-3.5" />
                    <span className="sr-only">Ask AI</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Ask AI</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <SettingsModal>
                  <Button title="Preferences" variant="ghost" size="icon">
                    <SettingsIcon className="size-3.5" />
                    <span className="sr-only">Preferences</span>
                  </Button>
                </SettingsModal>
                <TooltipContent>
                  <p>Preferences</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    title="Disconnect"
                  >
                    <UnplugIcon className="size-3.5" />
                    <span className="sr-only">Disconnect</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Disconnect</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
};

export default memo(MainDataView);
