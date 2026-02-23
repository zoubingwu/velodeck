import type { DataEntityRef } from "@shared/contracts";
import { Table2Icon } from "lucide-react";
import { memo } from "react";
import { File, Folder, Tree } from "@/components/ui/file-tree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

export type ExplorerTreeNode = {
  nodeId: string;
  label: string;
  expandable: boolean;
  isLoadingChildren?: boolean;
  entityRef?: DataEntityRef;
  children: ExplorerTreeNode[];
};

type DatabaseTreeProps = {
  rootNodes: ExplorerTreeNode[];
  isLoading: boolean;
  loadError: Error | null;
  onExpandNode: (nodeId: string) => void;
  onSelectEntity: (entity: DataEntityRef) => void;
  selectedEntityNodeId: string;
};

function renderNode(
  node: ExplorerTreeNode,
  onExpandNode: (nodeId: string) => void,
  onSelectEntity: (entity: DataEntityRef) => void,
  selectedEntityNodeId: string,
) {
  if (!node.expandable) {
    return (
      <File
        key={node.nodeId}
        value={node.nodeId}
        isSelect={selectedEntityNodeId === node.nodeId}
        onClick={(event) => {
          event.stopPropagation();
          if (node.entityRef) {
            onSelectEntity(node.entityRef);
          }
        }}
        fileIcon={<Table2Icon className="size-4" />}
      >
        {node.label}
      </File>
    );
  }

  return (
    <Folder
      key={node.nodeId}
      element={node.label}
      value={node.nodeId}
      onExpand={onExpandNode}
    >
      {node.isLoadingChildren ? (
        <File
          isSelectable={false}
          value={`${node.nodeId}:loading`}
          className="text-muted-foreground italic"
        >
          Loading...
        </File>
      ) : node.children.length > 0 ? (
        node.children.map((child) =>
          renderNode(child, onExpandNode, onSelectEntity, selectedEntityNodeId),
        )
      ) : (
        <File
          isSelectable={false}
          value={`${node.nodeId}:empty`}
          className="text-muted-foreground italic"
        >
          Empty
        </File>
      )}
    </Folder>
  );
}

export const DatabaseTree = memo(
  ({
    rootNodes,
    isLoading,
    loadError,
    onExpandNode,
    onSelectEntity,
    selectedEntityNodeId,
  }: DatabaseTreeProps) => {
    const defaultExpandedItems = rootNodes.map((node) => node.nodeId);

    return (
      <ScrollArea className="h-full bg-muted/50">
        {isLoading ? (
          <div className="p-2 space-y-2">
            <Skeleton className="h-4 rounded-2xl" />
            <Skeleton className="h-4 rounded-2xl" />
            <Skeleton className="h-4 rounded-2xl" />
            <Skeleton className="h-4 rounded-2xl w-3/5" />
          </div>
        ) : loadError ? (
          <div className="p-2 text-center text-destructive">
            Error loading explorer: {loadError.message}
          </div>
        ) : (
          <Tree
            key={defaultExpandedItems.join("|")}
            className="p-2"
            initialExpandedItems={defaultExpandedItems}
          >
            {rootNodes.map((node) =>
              renderNode(
                node,
                onExpandNode,
                onSelectEntity,
                selectedEntityNodeId,
              ),
            )}
          </Tree>
        )}
      </ScrollArea>
    );
  },
);
