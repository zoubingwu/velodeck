import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
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
import type { services } from "@/bridge";
import {
  EventsOn,
  ExtractDatabaseMetadata,
  GetConnectionCapabilities,
  GetDatabaseMetadata,
  GetTableData,
  ListNamespaces,
  ListTables,
} from "@/bridge";
import { AIPanel } from "@/components/AIPanel";
import { DatabaseTree, type DatabaseTreeItem } from "@/components/DatabaseTree";
import { DataTablePagination } from "@/components/DataTablePagination";
import { Button } from "@/components/ui/button";
import {
  DataTableFilter,
  type ServerSideFilter,
} from "@/components/ui/data-table-filter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { filterFn } from "@/lib/filters";
import {
  ColumnDataTypeIcons,
  isSystemDatabase,
  mapDbColumnTypeToFilterType,
} from "@/lib/utils";
import "allotment/dist/style.css";
import { Loader, SettingsIcon, SparkleIcon, UnplugIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useImmer } from "use-immer";
import DataTable from "./DataTable";
import SettingsModal from "./SettingModal";
import TablePlaceholder from "./TablePlaceHolder";

type TableRowData = Record<string, any>;
type DatabaseTreeData = DatabaseTreeItem[];

type TableState = {
  namespaceName: string;
  tableName: string;
  pageSize: number;
  pageIndex: number;
  serverFilters: ServerSideFilter[];
};

const defaultPageSize = 50;
const defaultTableState: TableState = {
  namespaceName: "",
  tableName: "",
  pageSize: defaultPageSize,
  pageIndex: 0,
  serverFilters: [],
};

const TITLE_BAR_HEIGHT = 0;
const FOOTER_HEIGHT = 40;
const DEFAULT_DB_TREE_WIDTH = 240;
const DEFAULT_AI_PANEL_WIDTH = 300;
const TABLE_HEIGHT = window.innerHeight - TITLE_BAR_HEIGHT - FOOTER_HEIGHT;

const LAYOUT_DB_TREE_WIDTH_KEY = "layout:dbTreeWidth";
const LAYOUT_AI_PANEL_WIDTH_KEY = "layout:aiPanelWidth";
const LAYOUT_AI_PANEL_VISIBLE_KEY = "layout:aiPanelVisible";

const SHOW_SYSTEM_DATABASES = false;

const MainDataView = ({
  onClose,
  connectionDetails,
}: {
  onClose: () => void;
  connectionDetails: services.ConnectionDetails | null;
}) => {
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [databaseTree, setDatabaseTree] = useImmer<DatabaseTreeData>([]);
  const [tableState, setTableState] = useImmer<TableState>(defaultTableState);

  const currentNamespace = tableState.namespaceName;
  const currentTable = tableState.tableName;
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

  const mergeDatabaseTree = useMemoizedFn(
    (
      entries: {
        namespaceName: string;
        tables?: string[];
        isLoadingTables?: boolean;
      }[],
    ) => {
      setDatabaseTree((draft) => {
        entries.forEach((entry) => {
          const existing = draft.find(
            (item) => item.name === entry.namespaceName,
          );
          if (existing) {
            if (entry.tables) {
              existing.tables = entry.tables;
            }
            existing.isLoadingTables = entry.isLoadingTables ?? false;
            return;
          }

          draft.push({
            name: entry.namespaceName,
            tables: entry.tables || [],
            isLoadingTables: entry.isLoadingTables ?? false,
          });
        });

        draft.sort((a, b) => {
          const isASystemDb = isSystemDatabase(a.name);
          const isBSystemDb = isSystemDatabase(b.name);
          if (isASystemDb && !isBSystemDb) {
            return -1;
          }
          if (!isASystemDb && isBSystemDb) {
            return 1;
          }
          return a.name.localeCompare(b.name);
        });
      });
    },
  );

  const { data: connectionCapabilities } = useQuery<
    services.AdapterCapabilities,
    Error
  >({
    queryKey: ["connectionCapabilities", connectionDetails?.id],
    queryFn: GetConnectionCapabilities,
    enabled: Boolean(connectionDetails?.id),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const {
    data: namespaces = [],
    isLoading: isLoadingNamespaces,
    error: namespacesError,
  } = useQuery<services.NamespaceRef[], Error>({
    queryKey: ["namespaces"],
    queryFn: ListNamespaces,
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const indexStartedRef = useRef(false);
  const triggerIndexer = useMemoizedFn(
    (force: boolean, namespaceName?: string) => {
      if (indexStartedRef.current && !force) {
        return;
      }
      indexStartedRef.current = true;

      appendActivityLog("Indexing metadata...");
      const connectionId = connectionDetails?.id;
      if (!connectionId) {
        appendActivityLog("Indexing skipped: no active connection.");
        return;
      }

      void ExtractDatabaseMetadata({
        connectionId,
        force,
        namespaceName: namespaceName ?? "",
      }).catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        appendActivityLog(`Indexing metadata failed: ${message}`);
      });
    },
  );

  useEffect(() => {
    if (!namespaces.length) {
      return;
    }

    const visibleNamespaces = namespaces
      .map((item) => item.namespaceName)
      .filter((name) =>
        connectionDetails?.kind === "mysql" && !SHOW_SYSTEM_DATABASES
          ? !isSystemDatabase(name)
          : true,
      );

    mergeDatabaseTree(
      visibleNamespaces.map((namespaceName) => ({ namespaceName })),
    );

    const checkMetadataAndTriggerIndexer = async () => {
      try {
        const metadata = await GetDatabaseMetadata();
        const existing = Object.keys(metadata?.namespaces || {});
        const missing = visibleNamespaces.filter(
          (name) => !existing.includes(name),
        );
        if (missing.length > 0) {
          missing.forEach((namespaceName) =>
            triggerIndexer(true, namespaceName),
          );
        }
      } catch {
        triggerIndexer(true);
      }
    };

    void checkMetadataAndTriggerIndexer();
  }, [namespaces, connectionDetails?.kind, mergeDatabaseTree, triggerIndexer]);

  useEffect(() => {
    const cleanupFailed = EventsOn("metadata:extraction:failed", (payload) => {
      const error =
        typeof payload === "string"
          ? payload
          : String(payload ?? "unknown error");
      appendActivityLog(`Indexing metadata failed: ${error}`);
    });

    const cleanupCompleted = EventsOn(
      "metadata:extraction:completed",
      async (payload) => {
        const metadata = payload as services.ConnectionMetadata;
        appendActivityLog("Indexing metadata completed.");
        if (metadata.version) {
          appendActivityLog(`Connected to ${metadata.version}`);
        }

        mergeDatabaseTree(
          Object.keys(metadata.namespaces).map((namespaceName) => ({
            namespaceName,
            tables: metadata.namespaces[namespaceName].tables.map(
              (table) => table.name,
            ),
            isLoadingTables: false,
          })),
        );
      },
    );

    triggerIndexer(false);

    return () => {
      cleanupFailed();
      cleanupCompleted();
    };
  }, [appendActivityLog, mergeDatabaseTree, triggerIndexer]);

  const { mutateAsync: fetchTables } = useMutation({
    mutationFn: (namespaceName: string) => ListTables(namespaceName),
    onMutate: (namespaceName: string) => {
      if (
        !databaseTree.find((db) => db.name === namespaceName)?.tables?.length
      ) {
        mergeDatabaseTree([{ namespaceName, isLoadingTables: true }]);
      }
    },
    onSuccess: (tables, namespaceName) => {
      mergeDatabaseTree([
        {
          namespaceName,
          tables: tables.map((table) => table.tableName),
          isLoadingTables: false,
        },
      ]);
    },
    onError: (error, namespaceName) => {
      mergeDatabaseTree([{ namespaceName, isLoadingTables: false }]);
      appendActivityLog(`Error fetching tables: ${error.message}`);
    },
  });

  const { data: tableData, isFetching: isFetchingTableData } = useQuery({
    enabled: !!currentNamespace && !!currentTable,
    queryKey: [
      "tableData",
      currentNamespace,
      currentTable,
      currentPageSize,
      currentPageIndex,
      currentServerFilters,
    ],
    queryFn: async () => {
      const filterObject =
        connectionCapabilities?.supportsServerSideFilter === false
          ? null
          : currentServerFilters.length > 0
            ? { filters: currentServerFilters }
            : null;

      const titleTarget = `${currentNamespace}.${currentTable}`;

      try {
        appendActivityLog(`Fetching data from ${titleTarget}...`);
        const res = await GetTableData(
          currentNamespace,
          currentTable,
          currentPageSize,
          currentPageIndex * currentPageSize,
          filterObject,
        );
        appendActivityLog(`Fetched data from ${titleTarget}`);
        return res;
      } catch (error: any) {
        appendActivityLog(
          `Error fetching ${titleTarget}: ${error?.message || String(error)}`,
        );
        toast.error("Error fetching table data", {
          description: error,
        });
        throw error;
      }
    },
    placeholderData: keepPreviousData,
  });

  const handleFilterChange = useMemoizedFn((filters: ServerSideFilter[]) => {
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

    if (!tableData?.columns) {
      return [];
    }

    return tableData.columns.map((column): ColumnDef<TableRowData> => {
      const type = mapDbColumnTypeToFilterType(column.type);
      return {
        accessorKey: column.name,
        header: column.name,
        cell: renderCell,
        filterFn: filterFn(type),
        meta: {
          displayName: column.name,
          type,
          icon: ColumnDataTypeIcons[type],
        },
      };
    });
  }, [tableData?.columns]);

  const totalRowCount = tableData?.totalRows;

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
    if (isLoadingNamespaces) {
      return "init";
    }

    if (isFetchingTableData) {
      return "loading";
    }

    if (currentNamespace && currentTable && tableData?.columns?.length) {
      return "data";
    }

    return "empty";
  })();

  const handleSelectNamespace = useMemoizedFn((namespaceName: string) => {
    void fetchTables(namespaceName);
  });

  const handleSelectTable = useMemoizedFn(
    (namespaceName: string, tableName: string) => {
      setTableState((draft) => {
        draft.namespaceName = namespaceName;
        draft.tableName = tableName;
        draft.serverFilters = [];
        draft.pageIndex = 0;
      });
    },
  );

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

  const data = useMemo(() => tableData?.rows ?? [], [tableData]);

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

  return (
    <div className="flex flex-col h-full">
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
            databaseTree={databaseTree}
            isLoadingDatabases={
              isLoadingNamespaces && databaseTree.length === 0
            }
            databasesError={namespacesError}
            onSelectDatabase={handleSelectNamespace}
            onSelectTable={handleSelectTable}
            selectedTable={{ db: currentNamespace, table: currentTable }}
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
            <ReactSplitView.Pane minSize={200}>
              {tableViewState === "data" ? (
                <DataTable<TableRowData> table={table} height={TABLE_HEIGHT} />
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
