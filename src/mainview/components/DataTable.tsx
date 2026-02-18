import { flexRender, Table as ReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData> {
  table: ReactTable<TData>;
  height: number;
}

function DataTable<TData>({ table, height }: DataTableProps<TData>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 2,
  });

  return (
    <div
      ref={parentRef}
      className="data-table-scroll overflow-auto tabular-nums"
      style={{ height }}
    >
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <table className="min-w-full text-sm after:inline-block after:h-(--table-height)">
          <TableHeader className="sticky z-50 top-0 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{
                      width:
                        header.getSize() === Number.MAX_SAFE_INTEGER
                          ? "auto"
                          : header.getSize(),
                    }}
                    className="px-4 select-text!"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            ref={(ref) => {
              if (!ref) return;

              const height =
                virtualizer.getTotalSize() - ref.getBoundingClientRect().height;

              document.documentElement.style.setProperty(
                "--table-height",
                `${height}px`,
              );
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow, index) => {
              const row = rows[virtualRow.index];
              return (
                <TableRow
                  key={row.id}
                  className={`${virtualRow.index % 2 === 0 ? "bg-muted/25" : "bg-background"}`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${
                      virtualRow.start - index * virtualRow.size
                    }px)`,
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    return (
                      <TableCell
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="max-w-[250px] truncate px-4 select-text!"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
