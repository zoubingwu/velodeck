import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { useUncontrolled } from "@/hooks/use-uncontrolled";
import { take, uniq } from "@/lib/array";
import {
  type ColumnDataType,
  type FilterModel,
  createNumberRange,
  dateFilterDetails,
  filterTypeOperatorDetails,
  getColumn,
  getColumnMeta,
  isColumnOptionArray,
  isFilterableColumn,
  multiOptionFilterDetails,
  numberFilterDetails,
  optionFilterDetails,
  textFilterDetails,
} from "@/lib/filters";
import type { ColumnOption, ElementType } from "@/lib/filters";
import { cn } from "@/lib/utils";
import type { Column, ColumnMeta, RowData, Table } from "@tanstack/react-table";
import { useDebounce, useMemoizedFn } from "ahooks";
import { format, isEqual } from "date-fns";
import { ArrowRight, Ellipsis, Filter, X } from "lucide-react";
import React, {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import type { DateRange } from "react-day-picker";

// Type to represent a serializable filter that can be sent to the server
export type ServerSideFilter = {
  columnId: string;
  operator: string;
  type: ColumnDataType;
  values: any[];
};

// --- Filter Context ---

interface DataTableFilterContextType {
  filters: ServerSideFilter[];
  addOrUpdateFilter: (filter: ServerSideFilter) => void;
  removeFilter: (columnId: string) => void;
  clearFilters: () => void;
  getFilter: (columnId: string) => ServerSideFilter | undefined;
}

const DataTableFilterContext = createContext<
  DataTableFilterContextType | undefined
>(undefined);

export const useDataTableFilter = () => {
  const context = useContext(DataTableFilterContext);
  if (!context) {
    throw new Error(
      "useDataTableFilter must be used within a DataTableFilterProvider",
    );
  }
  return context;
};

interface DataTableFilterProviderProps {
  children: React.ReactNode;
  onChange?: (filters: ServerSideFilter[]) => void;
  initialFilters?: ServerSideFilter[];
}

export const DataTableFilterProvider = ({
  children,
  onChange,
  initialFilters = [],
}: DataTableFilterProviderProps) => {
  const [filters, setFilters] = useState<ServerSideFilter[]>(initialFilters);

  const addOrUpdateFilter = useMemoizedFn((newFilter: ServerSideFilter) => {
    setFilters((currentFilters) => {
      const existingIndex = currentFilters.findIndex(
        (f) => f.columnId === newFilter.columnId,
      );
      if (existingIndex !== -1) {
        // Update existing filter
        const updatedFilters = [...currentFilters];
        updatedFilters[existingIndex] = newFilter;
        return updatedFilters;
      } else {
        // Add new filter
        return [...currentFilters, newFilter];
      }
    });
  });

  const removeFilter = useMemoizedFn((columnId: string) => {
    setFilters((currentFilters) => {
      const nextFilters = currentFilters.filter((f) => f.columnId !== columnId);
      return nextFilters;
    });
  });

  const clearFilters = useMemoizedFn(() => {
    setFilters([]);
  });

  const getFilter = useMemoizedFn(
    (columnId: string): ServerSideFilter | undefined => {
      return filters.find((f) => f.columnId === columnId);
    },
  );

  const debouncedValue = useDebounce(filters, { wait: 500 });

  useEffect(() => {
    onChange?.(debouncedValue);
  }, [debouncedValue]);

  const value = {
    filters,
    addOrUpdateFilter,
    removeFilter,
    clearFilters,
    getFilter,
  };

  return (
    <DataTableFilterContext.Provider value={value}>
      {children}
    </DataTableFilterContext.Provider>
  );
};

type DataTableFilterProps<TData> = {
  table: Table<TData>;
  onChange?: (filters: ServerSideFilter[]) => void;
  initialFilters?: ServerSideFilter[];
  disabled?: boolean;
};

export const DataTableFilter = <TData,>({
  table,
  onChange,
  initialFilters,
  disabled = false,
}: DataTableFilterProps<TData>) => {
  return (
    // Wrap the filter UI with the Provider
    <DataTableFilterProvider
      onChange={onChange}
      initialFilters={initialFilters}
    >
      <div className="flex w-full flex-grow items-start justify-between gap-2">
        <div className="flex md:flex-wrap gap-2 w-full flex-1">
          {/* Pass table for metadata, but filter logic uses context */}
          <FilterSelector table={table} disabled={disabled} />
          <ActiveFilters table={table} />
        </div>
      </div>
    </DataTableFilterProvider>
  );
};

export function FilterSelector<TData>({
  table,
  disabled,
}: {
  table: Table<TData>;
  disabled: boolean;
}) {
  const { filters } = useDataTableFilter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [property, setProperty] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const column = property ? getColumn(table, property) : undefined;
  const columnMeta = property ? getColumnMeta(table, property) : undefined;

  const properties = table.getAllColumns().filter(isFilterableColumn);
  const hasFilters = filters.length > 0; // Use context filter length

  useEffect(() => {
    if (property && inputRef) {
      inputRef.current?.focus();
      setValue("");
    }
  }, [property]);

  useEffect(() => {
    if (!open) setTimeout(() => setValue(""), 150);
  }, [open]);

  const content = useMemo(
    () =>
      property && column && columnMeta ? (
        // Pass table for metadata, but value controller will use context
        <FitlerValueController
          id={property}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // No onChange needed here, controllers update context directly
        />
      ) : (
        <Command loop>
          <CommandInput
            value={value}
            onValueChange={setValue}
            ref={inputRef}
            placeholder="Search..."
          />
          <CommandEmpty>No results.</CommandEmpty>
          <CommandList className="max-h-fit">
            <CommandGroup>
              {properties.map((column) => (
                <FilterableColumn
                  key={column.id}
                  column={column}
                  setProperty={setProperty}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      ),
    // onChange removed from dependency array
    [property, column, columnMeta, value, table, properties],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setTimeout(() => setProperty(undefined), 100);
      }}
    >
      <PopoverTrigger asChild>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(hasFilters && "w-fit !px-2")}
            disabled={disabled}
          >
            <Filter className="size-3.5" />
          </Button>
        </TooltipTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-fit p-0 origin-(--radix-popover-content-transform-origin)"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function FilterableColumn<TData>({
  column,
  setProperty,
}: {
  column: Column<TData>;
  // table: Table<TData>; // Remove if not needed
  setProperty: (value: string) => void;
}) {
  // Ensure meta exists and has icon and displayName before accessing
  const meta = column.columnDef.meta as ColumnMeta<TData, unknown> | undefined;
  const Icon = meta?.icon;
  const displayName = meta?.displayName ?? column.id; // Fallback to column id

  return (
    <CommandItem onSelect={() => setProperty(column.id)} className="group">
      <div className="flex w-full items-center justify-between">
        <div className="inline-flex items-center gap-1.5">
          {Icon && <Icon strokeWidth={2.25} className="size-4" />}
          <span>{displayName}</span>
        </div>
        <ArrowRight className="size-4 opacity-0 group-aria-selected:opacity-100" />
      </div>
    </CommandItem>
  );
}

export function TextInput({
  value: initialValue,
  onChange,
  ...props
}: {
  value: string | number;
  onChange: (value: string | number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  const [value, setValue] = useUncontrolled({
    defaultValue: initialValue,
    onChange,
  });

  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      autoComplete="off"
      autoCorrect="off"
      spellCheck="false"
    />
  );
}

export function ActiveFilters<TData>({ table }: { table: Table<TData> }) {
  const { filters } = useDataTableFilter(); // Use context

  if (filters.length === 0) {
    return null; // No filters, render nothing
  }

  if (filters.length === 1) {
    // Render the single filter directly
    const filter = filters[0];
    const { columnId } = filter;
    const column = getColumn(table, columnId);
    if (!column) return null;
    const meta = getColumnMeta(table, columnId);

    return (
      <ActiveFilterDisplay
        key={`filter-${columnId}`}
        filter={filter}
        column={column}
        meta={meta}
        table={table}
      />
    );
  }

  // Render multiple filters inside a Popover
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-6 px-2 text-xs flex items-center gap-1"
        >
          {filters.length} Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex flex-col items-start gap-2">
          {filters.map((filter) => {
            const { columnId } = filter;
            const column = getColumn(table, columnId);
            if (!column) return null;
            const meta = getColumnMeta(table, columnId);

            return (
              <ActiveFilterDisplay
                key={`filter-${columnId}`}
                filter={filter}
                column={column}
                meta={meta}
                table={table}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// New component to render a single active filter based on context state
function ActiveFilterDisplay<TData, T extends ColumnDataType>({
  filter,
  column,
  meta,
  table,
}: {
  filter: ServerSideFilter; // Use ServerSideFilter type
  column: Column<TData, unknown>;
  meta: ColumnMeta<TData, unknown>; // Type T is now in filter.type
  table: Table<TData>;
  // Removed onChange, uses context
}) {
  const { removeFilter } = useDataTableFilter(); // Use context for removal

  const handleRemoveFilter = () => {
    removeFilter(filter.columnId);
  };

  // Reconstruct a partial FilterModel shape if needed by display components,
  // using data from the ServerSideFilter in context
  const displayFilterModel: Partial<FilterModel<T, TData>> = {
    operator: filter.operator as any, // Cast might be needed depending on strictness
    values: filter.values,
  };

  return (
    <div
      key={`filter-${filter.columnId}`}
      className="flex items-center text-xs"
    >
      <FilterSubject meta={meta} />
      {/* <Separator orientation="vertical" /> */}
      <FilterOperator
        column={column}
        columnMeta={meta}
        filter={displayFilterModel as FilterModel<T, TData>} // Pass the reconstructed model
        table={table}
        // No onChange needed
      />
      {/* <Separator orientation="vertical" /> */}
      <FilterValue
        id={filter.columnId} // Pass columnId
        column={column}
        columnMeta={meta}
        table={table}
        // No onChange needed
      />
      {/* <Separator orientation="vertical" /> */}
      <Button
        variant="ghost"
        size="icon"
        className=" text-xs"
        onClick={handleRemoveFilter} // Use context remove function
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

/****** Property Filter Subject (Unchanged) ******/
export function FilterSubject<TData>({
  meta,
}: {
  meta: ColumnMeta<TData, unknown>; // Adjusted type slightly
}) {
  // Ensure meta exists and has icon and displayName before accessing
  const hasIcon = !!meta?.icon;
  const displayName = meta?.displayName ?? "Unknown Column"; // Fallback

  return (
    <span className="flex select-none items-center gap-1 whitespace-nowrap px-2 font-medium">
      {hasIcon && meta.icon && <meta.icon className="size-4 stroke-[2.25px]" />}
      <span>{displayName}</span>
    </span>
  );
}

export function FilterOperator<TData, T extends ColumnDataType>({
  column,
  columnMeta,
  filter,
  table,
}: {
  column: Column<TData, unknown>;
  columnMeta: ColumnMeta<TData, unknown>;
  filter: FilterModel<T, TData>;
  table: Table<TData>;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const close = () => setOpen(false);

  const filterType = columnMeta.type as T; // Get type from meta

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="m-0 h-full w-fit whitespace-nowrap rounded-none p-0 px-2 text-xs"
        >
          {/* Pass reconstructed filter model for display */}
          <FilterOperatorDisplay filter={filter} filterType={filterType} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-fit p-0 origin-(--radix-popover-content-transform-origin)"
      >
        <Command loop>
          <CommandInput placeholder="Search..." />
          <CommandEmpty>No results.</CommandEmpty>
          <CommandList className="max-h-fit">
            {/* Controller now uses context */}
            <FilterOperatorController
              column={column}
              closeController={close}
              table={table}
              // onChange removed
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// FilterOperatorDisplay remains largely the same, depends on passed filter prop
export function FilterOperatorDisplay<TData, T extends ColumnDataType>({
  filter,
  filterType,
}: {
  filter: FilterModel<T, TData>; // Takes the potentially reconstructed filter model
  filterType: T;
}) {
  // Handle cases where filter or operator might be missing in the passed prop
  if (!filter?.operator || !filterTypeOperatorDetails[filterType]) {
    return <span>Op?</span>; // Or some placeholder
  }
  const details = filterTypeOperatorDetails[filterType][filter.operator];
  if (!details) {
    return <span>Op?</span>; // Operator might not exist for the type
  }
  return <span>{details.label}</span>;
}

// FilterOperatorController uses context
interface FilterOperatorControllerProps<TData> {
  column: Column<TData, unknown>;
  closeController: () => void;
  table: Table<TData>; // Keep for column meta access if needed
  // onChange removed
}

// Main dispatcher remains the same structure
export function FilterOperatorController<TData>({
  column,
  closeController,
  table,
}: // onChange removed
FilterOperatorControllerProps<TData>) {
  const meta = column.columnDef.meta as ColumnMeta<TData, unknown>;
  if (!meta?.type) return null; // Need type info

  const { type } = meta;

  switch (type) {
    case "option":
      return (
        <FilterOperatorOptionController
          column={column}
          closeController={closeController}
          table={table}
        />
      );
    case "multiOption":
      return (
        <FilterOperatorMultiOptionController
          column={column}
          closeController={closeController}
          table={table}
        />
      );
    case "date":
      return (
        <FilterOperatorDateController
          column={column}
          closeController={closeController}
          table={table}
        />
      );
    case "text":
      return (
        <FilterOperatorTextController
          column={column}
          closeController={closeController}
          table={table}
        />
      );
    case "number":
      return (
        <FilterOperatorNumberController
          column={column}
          closeController={closeController}
          table={table}
        />
      );
    default:
      return null;
  }
}

function FilterOperatorOptionController<TData>({
  column,
  closeController,
}: FilterOperatorControllerProps<TData>) {
  const { getFilter, addOrUpdateFilter } = useDataTableFilter();
  const currentFilter = getFilter(column.id); // Get filter state from context

  // Determine current operator safely
  const currentOperator = currentFilter?.operator ?? "is"; // Default or derive if needed
  const filterDetails =
    optionFilterDetails[currentOperator as keyof typeof optionFilterDetails];

  if (!filterDetails) return null; // Operator might not be valid for this type

  const relatedFilters = Object.values(optionFilterDetails).filter(
    (o) => o.target === filterDetails.target,
  );

  const changeOperator = (newOperator: string) => {
    // Update context instead of column.setFilterValue
    addOrUpdateFilter({
      columnId: column.id,
      operator: newOperator,
      type: "option",
      // Preserve existing values when changing operator
      values: currentFilter?.values ?? [],
    });
    closeController();
  };

  return (
    <CommandGroup heading="Operators">
      {relatedFilters.map((r) => {
        return (
          <CommandItem
            onSelect={() => changeOperator(r.value)}
            value={r.value}
            key={r.value}
          >
            {r.label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function FilterOperatorMultiOptionController<TData>({
  column,
  closeController,
}: FilterOperatorControllerProps<TData>) {
  const { getFilter, addOrUpdateFilter } = useDataTableFilter();
  const currentFilter = getFilter(column.id);

  const currentOperator = currentFilter?.operator ?? "include";
  const filterDetails =
    multiOptionFilterDetails[
      currentOperator as keyof typeof multiOptionFilterDetails
    ];

  if (!filterDetails) return null;

  const relatedFilters = Object.values(multiOptionFilterDetails).filter(
    (o) => o.target === filterDetails.target,
  );

  const changeOperator = (newOperator: string) => {
    addOrUpdateFilter({
      columnId: column.id,
      operator: newOperator,
      type: "multiOption",
      values: currentFilter?.values ?? [[]], // Ensure values structure is correct
    });
    closeController();
  };

  return (
    <CommandGroup heading="Operators">
      {relatedFilters.map((r) => {
        return (
          <CommandItem
            onSelect={() => changeOperator(r.value)}
            value={r.value}
            key={r.value}
          >
            {r.label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function FilterOperatorDateController<TData>({
  column,
  closeController,
}: FilterOperatorControllerProps<TData>) {
  const { getFilter, addOrUpdateFilter } = useDataTableFilter();
  const currentFilter = getFilter(column.id);

  const currentOperator = currentFilter?.operator ?? "is";
  const filterDetails =
    dateFilterDetails[currentOperator as keyof typeof dateFilterDetails];

  if (!filterDetails) return null;

  const relatedFilters = Object.values(dateFilterDetails).filter(
    (o) => o.target === filterDetails.target,
  );

  const changeOperator = (newOperator: string) => {
    addOrUpdateFilter({
      columnId: column.id,
      operator: newOperator,
      type: "date",
      values: currentFilter?.values ?? [],
    });
    closeController();
  };

  return (
    <CommandGroup>
      {relatedFilters.map((r) => {
        return (
          <CommandItem
            onSelect={() => changeOperator(r.value)}
            value={r.value}
            key={r.value}
          >
            {r.label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

export function FilterOperatorTextController<TData>({
  column,
  closeController,
}: FilterOperatorControllerProps<TData>) {
  const { getFilter, addOrUpdateFilter } = useDataTableFilter();
  const currentFilter = getFilter(column.id);

  const currentOperator = currentFilter?.operator ?? "contains";
  const filterDetails =
    textFilterDetails[currentOperator as keyof typeof textFilterDetails];

  if (!filterDetails) return null;

  const relatedFilters = Object.values(textFilterDetails).filter(
    (o) => o.target === filterDetails.target,
  );

  const changeOperator = (newOperator: string) => {
    addOrUpdateFilter({
      columnId: column.id,
      operator: newOperator,
      type: "text",
      values: currentFilter?.values ?? [],
    });
    closeController();
  };

  return (
    <CommandGroup heading="Operators">
      {relatedFilters.map((r) => {
        return (
          <CommandItem
            onSelect={() => changeOperator(r.value)}
            value={r.value}
            key={r.value}
          >
            {r.label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function FilterOperatorNumberController<TData>({
  column,
  closeController,
}: FilterOperatorControllerProps<TData>) {
  const { getFilter, addOrUpdateFilter } = useDataTableFilter();
  const currentFilter = getFilter(column.id);

  const relatedFilters = Object.values(numberFilterDetails);

  const changeOperator = (newOperator: keyof typeof numberFilterDetails) => {
    const target = numberFilterDetails[newOperator].target;
    const currentValues = currentFilter?.values ?? [0]; // Default value if none exists

    // Adjust values based on the new operator's target (single vs multiple)
    const newValues =
      target === "single"
        ? [currentValues[0]]
        : createNumberRange(currentValues); // Ensure it's a valid range

    addOrUpdateFilter({
      columnId: column.id,
      operator: newOperator,
      type: "number",
      values: newValues,
    });
    closeController();
  };

  return (
    <div>
      <CommandGroup heading="Operators">
        {relatedFilters.map((r) => (
          <CommandItem
            onSelect={() => changeOperator(r.value)}
            value={r.value}
            key={r.value}
          >
            {r.label}
          </CommandItem>
        ))}
      </CommandGroup>
    </div>
  );
}

/****** Property Filter Value (Modified) ******/

export function FilterValue<TData, TValue>({
  id, // This is columnId
  column,
  columnMeta,
  table,
}: // onChange removed
{
  id: string;
  column: Column<TData>;
  columnMeta: ColumnMeta<TData, TValue>;
  table: Table<TData>;
  // onChange?: (filters: ServerSideFilter[]) => void; // Removed
}) {
  // Value display depends on context state, not direct filter value access
  // The controller component will handle updates via context
  return (
    <Popover>
      {/* PopoverAnchor might need adjustment if layout breaks */}
      {/* <PopoverAnchor className="h-full" /> */}
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="m-0 h-full w-fit whitespace-nowrap rounded-none p-0 px-2 text-xs"
        >
          {/* Display component now needs context access or filter passed */}
          <FilterValueDisplay
            id={id}
            column={column}
            columnMeta={columnMeta}
            table={table}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-fit p-0 origin-(--radix-popover-content-transform-origin)"
      >
        {/* Controller uses context */}
        <FitlerValueController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // onChange removed
        />
      </PopoverContent>
    </Popover>
  );
}

// Interface for display props might need adjustment if context is used directly
interface FilterValueDisplayProps<TData, TValue> {
  id: string; // columnId
  column: Column<TData>;
  columnMeta: ColumnMeta<TData, TValue>;
  table: Table<TData>;
}

// Dispatcher needs access to the filter state from context for display
export function FilterValueDisplay<TData, TValue>({
  id,
  column,
  columnMeta,
  table,
}: FilterValueDisplayProps<TData, TValue>) {
  // No direct context access here, components below will handle it or receive props
  switch (columnMeta.type) {
    case "option":
      return (
        <FilterValueOptionDisplay
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    case "multiOption":
      return (
        <FilterValueMultiOptionDisplay
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    case "date":
      return (
        <FilterValueDateDisplay
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    case "text":
      return (
        <FilterValueTextDisplay
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    case "number":
      return (
        <FilterValueNumberDisplay
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    default:
      return null;
  }
}

export function FilterValueOptionDisplay<TData, TValue>({
  id,
  columnMeta,
  table,
}: FilterValueDisplayProps<TData, TValue>) {
  const { getFilter } = useDataTableFilter();
  const filter = getFilter(id);

  let options: ColumnOption[];
  const columnVals = table
    .getCoreRowModel()
    .rows.flatMap((r) => r.getValue<TValue>(id))
    .filter((v): v is NonNullable<TValue> => v !== undefined && v !== null);
  const uniqueVals = uniq(columnVals);

  if (columnMeta.options) {
    options = columnMeta.options;
  } else if (columnMeta.transformOptionFn) {
    const transformOptionFn = columnMeta.transformOptionFn;
    options = uniqueVals.map((v) =>
      transformOptionFn(v as ElementType<NonNullable<TValue>>),
    );
  } else if (isColumnOptionArray(uniqueVals)) {
    options = uniqueVals as ColumnOption[];
  } else {
    console.error(
      `[data-table-filter] [${id}] Invalid config for option display`,
    );
    return <Ellipsis className="size-4" />; // Fallback display
  }

  // Determine selected based on context filter state
  const selectedValues = filter?.values ?? [];
  const selected = options.filter((o) => selectedValues.includes(o.value));

  if (selected.length === 0) {
    return <Ellipsis className="size-4" />;
  }

  if (selected.length === 1) {
    const { label, icon: Icon } = selected[0];
    const hasIcon = !!Icon;
    return (
      <span className="inline-flex items-center gap-1">
        {hasIcon &&
          (isValidElement(Icon) ? (
            Icon
          ) : (
            <Icon className="size-4 text-primary" />
          ))}
        <span>{label}</span>
      </span>
    );
  }
  // Plural name logic remains
  const name = columnMeta.displayName?.toLowerCase() ?? "items";
  const pluralName = name.endsWith("s") ? `${name}es` : `${name}s`;
  const hasOptionIcons = options?.every((o) => !!o.icon); // Check if ALL have icons

  return (
    <div className="inline-flex items-center gap-0.5">
      {hasOptionIcons &&
        take(selected, 3).map(({ value, icon }) => {
          const Icon = icon!;
          return isValidElement(Icon) ? (
            cloneElement(Icon, { key: value }) // Add key here
          ) : (
            <Icon key={value} className="size-4" />
          );
        })}
      <span className={cn(hasOptionIcons && selected.length > 0 && "ml-1.5")}>
        {selected.length} {pluralName}
      </span>
    </div>
  );
}

export function FilterValueMultiOptionDisplay<TData, TValue>({
  id,
  columnMeta,
  table,
}: FilterValueDisplayProps<TData, TValue>) {
  const { getFilter } = useDataTableFilter();
  const filter = getFilter(id);

  // Logic to get options remains
  let options: ColumnOption[];
  const columnVals = table
    .getCoreRowModel()
    .rows.flatMap((r) => r.getValue<TValue>(id))
    .filter((v): v is NonNullable<TValue> => v !== undefined && v !== null);
  const uniqueVals = uniq(columnVals);

  if (columnMeta.options) {
    options = columnMeta.options;
  } else if (columnMeta.transformOptionFn) {
    const transformOptionFn = columnMeta.transformOptionFn;
    options = uniqueVals.map((v) =>
      transformOptionFn(v as ElementType<NonNullable<TValue>>),
    );
  } else if (isColumnOptionArray(uniqueVals)) {
    options = uniqueVals as ColumnOption[];
  } else {
    console.error(
      `[data-table-filter] [${id}] Invalid config for multiOption display`,
    );
    return <Ellipsis className="size-4" />;
  }

  // Selected values from context filter
  const selectedValues = filter?.values?.[0] ?? []; // Expects values[0] to be the array
  const selected = options.filter((o) => selectedValues.includes(o.value));

  if (selected.length === 0) {
    return <Ellipsis className="size-4" />;
  }

  if (selected.length === 1) {
    const { label, icon: Icon } = selected[0];
    const hasIcon = !!Icon;
    return (
      <span className="inline-flex items-center gap-1.5">
        {hasIcon &&
          (isValidElement(Icon) ? (
            Icon
          ) : (
            <Icon className="size-4 text-primary" />
          ))}
        <span>{label}</span>
      </span>
    );
  }

  const name = columnMeta.displayName?.toLowerCase() ?? "items";
  const hasOptionIcons = options?.every((o) => !!o.icon); // Check if ALL have icons

  return (
    <div className="inline-flex items-center gap-1.5">
      {hasOptionIcons && (
        <div key="icons" className="inline-flex items-center gap-0.5">
          {take(selected, 3).map(({ value, icon }) => {
            const Icon = icon!;
            return isValidElement(Icon) ? (
              cloneElement(Icon, { key: value })
            ) : (
              <Icon key={value} className="size-4" />
            );
          })}
        </div>
      )}
      <span>
        {selected.length} {name}
        {selected.length !== 1 ? "s" : ""} {/* Simple pluralization */}
      </span>
    </div>
  );
}

// formatDateRange remains the same
function formatDateRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth && sameYear) {
    return `${format(start, "MMM d")} - ${format(end, "d, yyyy")}`;
  }
  if (sameYear) {
    return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
  }
  return `${format(start, "MMM d, yyyy")} - ${format(end, "MMM d, yyyy")}`;
}

export function FilterValueDateDisplay<TData, TValue>({
  id, // columnId
}: // column and columnMeta might not be needed if only reading context
FilterValueDisplayProps<TData, TValue>) {
  const { getFilter } = useDataTableFilter();
  const filter = getFilter(id); // Get filter state from context

  if (!filter || !filter.values || filter.values.length === 0) {
    return <Ellipsis className="size-4" />;
  }

  // Ensure values are dates before formatting
  const dateValues = filter.values
    .map((v) => (v instanceof Date ? v : new Date(v))) // Attempt conversion if not Date
    .filter((d) => !isNaN(d.getTime())); // Filter out invalid dates

  if (dateValues.length === 0) {
    return <Ellipsis className="size-4" />; // No valid dates
  }

  if (dateValues.length === 1) {
    const formattedDateStr = format(dateValues[0], "MMM d, yyyy");
    return <span>{formattedDateStr}</span>;
  }

  // Ensure we have two valid dates for range formatting
  if (dateValues.length >= 2) {
    const formattedRangeStr = formatDateRange(dateValues[0], dateValues[1]);
    return <span>{formattedRangeStr}</span>;
  }

  // Fallback if logic fails (e.g., unexpected number of valid dates)
  return <Ellipsis className="size-4" />;
}

export function FilterValueTextDisplay<TData, TValue>({
  id, // columnId
}: FilterValueDisplayProps<TData, TValue>) {
  const { getFilter } = useDataTableFilter();
  const filter = getFilter(id);

  if (
    !filter ||
    !filter.values ||
    filter.values.length === 0 ||
    String(filter.values[0]).trim() === ""
  ) {
    return <Ellipsis className="size-4" />;
  }

  const value = String(filter.values[0]); // Ensure it's a string
  return <span>{value}</span>;
}

export function FilterValueNumberDisplay<TData, TValue>({
  id, // columnId
  columnMeta, // Need meta for max value
}: FilterValueDisplayProps<TData, TValue>) {
  const { getFilter } = useDataTableFilter();
  const filter = getFilter(id);

  const maxFromMeta = columnMeta.max;
  const cappedMax = maxFromMeta ?? Number.MAX_SAFE_INTEGER;

  if (!filter || !filter.values || filter.values.length === 0) {
    return <Ellipsis className="size-4" />;
  }

  // Check operator to format range correctly
  if (
    filter.operator === "is between" ||
    filter.operator === "is not between"
  ) {
    if (filter.values.length < 2) return <Ellipsis className="size-4" />; // Need two values for range

    const minValue = Number(filter.values[0]);
    const rawMaxValue = Number(filter.values[1]);

    const maxValueDisplay =
      rawMaxValue === Number.POSITIVE_INFINITY || rawMaxValue >= cappedMax
        ? `${cappedMax}+`
        : rawMaxValue.toString();

    return (
      <span className="tabular-nums tracking-tight">
        {minValue} and {maxValueDisplay}
      </span>
    );
  }

  // For single value operators
  const value = Number(filter.values[0]);
  if (isNaN(value)) return <Ellipsis className="size-4" />; // Invalid number

  return <span className="tabular-nums tracking-tight">{value}</span>;
}

export function FitlerValueController<TData, TValue>({
  id, // columnId
  column,
  columnMeta,
  table,
}: // onChange removed
{
  id: string;
  column: Column<TData>;
  columnMeta: ColumnMeta<TData, TValue>;
  table: Table<TData>;
  // onChange?: (filters: ServerSideFilter[]) => void; // Removed
}) {
  switch (columnMeta.type) {
    case "option":
      return (
        <FilterValueOptionController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // onChange removed
        />
      );
    case "multiOption":
      return (
        <FilterValueMultiOptionController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // onChange removed
        />
      );
    case "date":
      return (
        <FilterValueDateController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // onChange removed
        />
      );
    case "text":
      return (
        <FilterValueTextController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
        />
      );
    case "number":
      return (
        <FilterValueNumberController
          id={id}
          column={column}
          columnMeta={columnMeta}
          table={table}
          // onChange removed
        />
      );
    default:
      return null;
  }
}

interface ProperFilterValueMenuProps<TData, TValue> {
  id: string; // columnId
  column: Column<TData>;
  columnMeta: ColumnMeta<TData, TValue>;
  table: Table<TData>; // Keep for data access if needed
  // onChange removed
}

export function FilterValueOptionController<TData, TValue>({
  id, // columnId
  columnMeta,
  table,
}: ProperFilterValueMenuProps<TData, TValue>) {
  const { getFilter, addOrUpdateFilter, removeFilter } = useDataTableFilter();
  const filter = getFilter(id); // Get current filter state

  // Option fetching logic remains the same (needs table data)
  let options: ColumnOption[];
  const columnVals = table
    .getCoreRowModel()
    .rows.flatMap((r) => r.getValue<TValue>(id))
    .filter((v): v is NonNullable<TValue> => v !== undefined && v !== null);
  const uniqueVals = uniq(columnVals);

  if (columnMeta.options) {
    options = columnMeta.options;
  } else if (columnMeta.transformOptionFn) {
    const transformOptionFn = columnMeta.transformOptionFn;
    options = uniqueVals.map((v) =>
      transformOptionFn(v as ElementType<NonNullable<TValue>>),
    );
  } else if (isColumnOptionArray(uniqueVals)) {
    options = uniqueVals as ColumnOption[];
  } else {
    console.error(
      `[data-table-filter] [${id}] Invalid config for option controller`,
    );
    options = []; // Prevent crash
  }

  // Count logic remains the same
  const optionsCount: Record<ColumnOption["value"], number> = columnVals.reduce(
    (acc, curr) => {
      let value: string | number;
      if (columnMeta.options && typeof curr === "string") {
        value = curr; // Assume value is directly the option value
      } else if (columnMeta.transformOptionFn) {
        value = columnMeta.transformOptionFn(
          curr as ElementType<NonNullable<TValue>>,
        ).value;
      } else if (typeof curr === "string" || typeof curr === "number") {
        value = curr; // Assume primitive is the value
      } else {
        return acc; // Skip if cannot determine value
      }
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<ColumnOption["value"], number>,
  );

  // Update context on selection change
  function handleOptionSelect(value: string, check: boolean) {
    const currentValues = filter?.values ?? [];
    let newValues: string[];
    let newOperator: string;

    if (check) {
      // Add value
      newValues = uniq([...currentValues, value]);
      newOperator = newValues.length > 1 ? "is any of" : "is";
    } else {
      // Remove value
      newValues = currentValues.filter((v) => v !== value);
      newOperator = newValues.length > 1 ? "is any of" : "is";
    }

    if (newValues.length === 0) {
      // If removing the last item, remove the filter entirely
      removeFilter(id);
    } else {
      addOrUpdateFilter({
        columnId: id,
        type: "option",
        operator: newOperator,
        values: newValues,
      });
    }
  }

  const currentSelectedValues = filter?.values ?? [];

  return (
    <Command loop>
      <CommandInput autoFocus placeholder="Search..." />
      <CommandEmpty>No results.</CommandEmpty>
      <CommandList className="max-h-fit">
        <CommandGroup>
          {options.map((option) => {
            const checked = currentSelectedValues.includes(option.value);
            const count = optionsCount[option.value] ?? 0;

            return (
              <CommandItem
                key={option.value}
                onSelect={() => handleOptionSelect(option.value, !checked)}
                className="group flex items-center justify-between gap-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    checked={checked}
                    // Simplified class logic
                    className={cn(
                      "transition-opacity",
                      checked
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  />
                  {option.icon &&
                    (isValidElement(option.icon) ? (
                      option.icon
                    ) : (
                      <option.icon className="size-4 text-primary" />
                    ))}
                  <span>
                    {option.label}
                    <sup
                      className={cn(
                        "ml-0.5 tabular-nums tracking-tight text-muted-foreground",
                        count === 0 && "slashed-zero",
                      )}
                    >
                      {count < 100 ? count : "100+"}
                    </sup>
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function FilterValueMultiOptionController<
  TData extends RowData,
  TValue,
>({
  id, // columnId
  columnMeta,
  table,
}: ProperFilterValueMenuProps<TData, TValue>) {
  const { getFilter, addOrUpdateFilter, removeFilter } = useDataTableFilter();
  const filter = getFilter(id); // Get current filter state

  // Option fetching logic remains
  let options: ColumnOption[];
  const columnVals = table
    .getCoreRowModel()
    .rows.flatMap((r) => r.getValue<TValue>(id))
    .filter((v): v is NonNullable<TValue> => v !== undefined && v !== null);
  const uniqueVals = uniq(columnVals);

  // If static options are provided, use them
  if (columnMeta.options) {
    options = columnMeta.options;
  }

  // No static options provided,
  // We should dynamically generate them based on the column data
  else if (columnMeta.transformOptionFn) {
    const transformOptionFn = columnMeta.transformOptionFn;

    options = uniqueVals.map((v) =>
      transformOptionFn(v as ElementType<NonNullable<TValue>>),
    );
  }

  // Make sure the column data conforms to ColumnOption type
  else if (isColumnOptionArray(uniqueVals)) {
    options = uniqueVals as ColumnOption[];
  }

  // Invalid configuration
  else {
    throw new Error(
      `[data-table-filter] [${id}] Either provide static options, a transformOptionFn, or ensure the column data conforms to ColumnOption type`,
    );
  }

  const optionsCount: Record<ColumnOption["value"], number> = columnVals.reduce(
    (acc, curr) => {
      const values = Array.isArray(curr) ? curr : [curr];
      values.forEach((item) => {
        let valueKey: string | number | undefined;
        if (
          columnMeta.options &&
          (typeof item === "string" || typeof item === "number")
        ) {
          valueKey = item;
        } else if (columnMeta.transformOptionFn) {
          valueKey = columnMeta.transformOptionFn(item as any)?.value;
        } else if (typeof item === "string" || typeof item === "number") {
          valueKey = item;
        }

        if (valueKey !== undefined) {
          acc[valueKey] = (acc[valueKey] ?? 0) + 1;
        }
      });
      return acc;
    },
    {} as Record<ColumnOption["value"], number>,
  );

  // Update context on selection change
  function handleOptionSelect(value: string, check: boolean) {
    const currentSelected = filter?.values?.[0] ?? [];
    let newSelected: string[];

    if (check) {
      newSelected = uniq([...currentSelected, value]);
    } else {
      newSelected = currentSelected.filter((v: string) => v !== value);
    }

    if (newSelected.length === 0) {
      removeFilter(id);
    } else {
      addOrUpdateFilter({
        columnId: id,
        type: "multiOption",
        operator: "include",
        values: [newSelected],
      });
    }
  }

  const currentSelectedValues = filter?.values?.[0] ?? [];

  return (
    <Command loop>
      <CommandInput autoFocus placeholder="Search..." />
      <CommandEmpty>No results.</CommandEmpty>
      <CommandList>
        <CommandGroup>
          {options.map((option) => {
            const checked = currentSelectedValues.includes(option.value);
            const count = optionsCount[option.value] ?? 0;

            return (
              <CommandItem
                key={option.value}
                onSelect={() => handleOptionSelect(option.value, !checked)}
                className="group flex items-center justify-between gap-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    checked={checked}
                    className={cn(
                      "transition-opacity",
                      checked
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  />
                  {option.icon &&
                    (isValidElement(option.icon) ? (
                      option.icon
                    ) : (
                      <option.icon className="size-4 text-primary" />
                    ))}
                  <span>
                    {option.label}
                    <sup
                      className={cn(
                        "ml-0.5 tabular-nums tracking-tight text-muted-foreground",
                        count === 0 && "slashed-zero",
                      )}
                    >
                      {count < 100 ? count : "100+"}
                    </sup>
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function FilterValueDateController<TData, TValue>({
  id, // columnId
}: ProperFilterValueMenuProps<TData, TValue>) {
  const { getFilter, addOrUpdateFilter, removeFilter } = useDataTableFilter();
  const filter = getFilter(id);

  // Initialize date state from context filter, converting potential string dates
  const initialFrom = filter?.values?.[0]
    ? new Date(filter.values[0])
    : new Date();
  const initialTo = filter?.values?.[1]
    ? new Date(filter.values[1])
    : undefined;

  const [date, setDate] = useState<DateRange | undefined>({
    from: !isNaN(initialFrom.getTime()) ? initialFrom : new Date(), // Validate parsed date
    to: initialTo && !isNaN(initialTo.getTime()) ? initialTo : undefined,
  });

  // Update context when date range changes
  function changeDateRange(value: DateRange | undefined) {
    const start = value?.from;
    const end =
      start && value?.to && !isEqual(start, value.to) ? value.to : undefined;

    setDate({ from: start, to: end }); // Update local state for calendar display

    // Prepare values for context state (could be undefined)
    const newValues = [start, end].filter(Boolean) as Date[]; // Only include valid dates

    if (newValues.length === 0) {
      removeFilter(id); // Remove filter if no dates selected
    } else {
      // Determine operator based on number of dates
      const newOperator = newValues.length > 1 ? "is between" : "is";

      addOrUpdateFilter({
        columnId: id,
        type: "date",
        operator: newOperator,
        // Store dates potentially as ISO strings for serialization
        values: newValues.map((d) => d.toISOString()),
      });
    }
  }

  return (
    <Command>
      <CommandList className="max-h-fit">
        <CommandGroup>
          <div>
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={changeDateRange}
              numberOfMonths={1}
            />
          </div>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function FilterValueTextController<TData, TValue>({
  id, // columnId
}: ProperFilterValueMenuProps<TData, TValue>) {
  const { getFilter, addOrUpdateFilter, removeFilter } = useDataTableFilter();
  const filter = getFilter(id);

  // Update context on text change
  const changeText = (value: string | number) => {
    const stringValue = String(value).trim();

    if (stringValue === "") {
      removeFilter(id); // Remove filter if input is empty
    } else {
      addOrUpdateFilter({
        columnId: id,
        type: "text",
        operator: "contains",
        values: [stringValue],
      });
    }
  };

  return (
    <Command>
      <CommandList className="max-h-fit">
        <CommandGroup>
          <CommandItem>
            <TextInput
              placeholder="Search..."
              autoFocus
              value={filter?.values?.[0] ?? ""}
              onChange={changeText}
            />
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function FilterValueNumberController<TData, TValue>({
  id, // columnId
  column,
  columnMeta,
}: ProperFilterValueMenuProps<TData, TValue>) {
  const { getFilter, addOrUpdateFilter, removeFilter } = useDataTableFilter();
  const filter = getFilter(id);

  const meta = columnMeta as ColumnMeta<TData, number>; // Assume number type
  const maxFromMeta = meta?.max;
  const cappedMax = maxFromMeta ?? Number.MAX_SAFE_INTEGER;

  // Try getting min from faceted values, default to 0
  const [datasetMin] = column.getFacetedMinMaxValues() ?? [0, cappedMax];

  const currentOperator = filter?.operator as
    | keyof typeof numberFilterDetails
    | undefined;
  const isRangeOperator =
    currentOperator &&
    numberFilterDetails[currentOperator]?.target === "multiple";

  // Initialize state based on context filter
  const getInitialInputValues = () => {
    const values = filter?.values;
    if (!values || values.length === 0) {
      return isRangeOperator
        ? ["0", cappedMax.toString()]
        : [datasetMin.toString()];
    }
    // Convert stored numbers back to strings for input, handling infinity/cap
    return values.map((val) =>
      val === Number.POSITIVE_INFINITY || val >= cappedMax
        ? `${cappedMax}+`
        : String(val),
    );
  };

  const [inputValues, setInputValues] = useState<string[]>(
    getInitialInputValues,
  );

  // Effect to reset input values if the operator type changes (single/range)
  useEffect(() => {
    setInputValues(getInitialInputValues());
  }, [isRangeOperator, filter?.values, datasetMin, cappedMax]); // Re-run if filter or operator type changes

  // Update context state
  const updateFilterState = (newOperator: string, newValues: number[]) => {
    // Ensure values are sorted for range operators if necessary
    const processedValues = [...newValues].sort((a, b) => a - b);

    addOrUpdateFilter({
      columnId: id,
      type: "number",
      operator: newOperator,
      // Store actual numbers, handle cap/infinity conversion here
      values: processedValues.map((val) =>
        val >= cappedMax ? Number.POSITIVE_INFINITY : val,
      ),
    });
  };

  // Handle direct input changes
  const handleInputChange = (index: number, value: string) => {
    const newStringValues = [...inputValues];
    let numericValue = Number.NaN;

    // Handle capped max input
    if (
      value.endsWith("+") &&
      Number.parseInt(value.slice(0, -1), 10) === cappedMax
    ) {
      newStringValues[index] = `${cappedMax}+`;
      numericValue = cappedMax; // Use cappedMax internally, convert to Infinity on save
    } else {
      newStringValues[index] = value;
      numericValue =
        value.trim() === "" ? Number.NaN : Number.parseInt(value, 10);
      if (!isNaN(numericValue) && numericValue >= cappedMax) {
        newStringValues[index] = `${cappedMax}+`; // Display capped max
        numericValue = cappedMax; // Use cappedMax internally
      }
    }

    setInputValues(newStringValues); // Update input display immediately

    // Parse all current input strings to numbers for filter update
    const parsedNumericValues = newStringValues.map((valStr) => {
      if (valStr === `${cappedMax}+`) return cappedMax;
      const num = Number.parseInt(valStr, 10);
      return isNaN(num) ? 0 : num; // Default invalid/empty to 0 or handle differently
    });

    // Determine operator based on current state or default
    const operatorToUse =
      filter?.operator ?? (isRangeOperator ? "is between" : "is");

    // Filter out NaN values before updating state, ensure correct array length
    const validNumericValues = parsedNumericValues.filter((n) => !isNaN(n));
    if (isRangeOperator && validNumericValues.length < 2) {
      // Handle case where range input becomes invalid (e.g., clearing one field)
      // Option 1: Remove filter? Option 2: Keep old value? Option 3: Use defaults?
      // Let's default to [min, max] or similar reasonable range if one field is cleared
      // For simplicity now, let's just prevent update if range inputs are bad.
      if (validNumericValues.length === 1) {
        // Maybe keep the valid value and adjust operator? Needs UX decision.
        // For now, let's just update with the partial valid data, operator determines interpretation
        updateFilterState(operatorToUse, validNumericValues);
      } else {
        removeFilter(id); // Or handle as error / reset
      }
    } else if (!isRangeOperator && validNumericValues.length === 0) {
      removeFilter(id); // Remove if single value is cleared/invalid
    } else {
      updateFilterState(operatorToUse, validNumericValues);
    }
  };

  // Handle tab change (single/range) -> This changes the OPERATOR primarily
  const changeType = (type: "single" | "range") => {
    const currentValues = filter?.values ?? [datasetMin]; // Use current values or default
    let newOperator: string;
    let newValues: number[];

    if (type === "single") {
      newOperator = "is";
      // Use the first value from current state, or datasetMin
      newValues = [currentValues[0] ?? datasetMin];
    } else {
      // Range
      newOperator = "is between";
      // Create a range from current values or default [min, max]
      newValues = createNumberRange(
        currentValues.length > 0 ? currentValues : [datasetMin, cappedMax],
      );
    }

    // Update the filter state with the new operator and adjusted values
    updateFilterState(newOperator, newValues);

    // We don't need to manually setInputValues here anymore,
    // the useEffect listening to isRangeOperator/filter.values will handle it.
  };

  // Prepare values for the Slider component
  const sliderValue = inputValues
    .map((val) => {
      if (val === `${cappedMax}+`) return cappedMax;
      const num = Number.parseInt(val, 10);
      return isNaN(num)
        ? datasetMin
        : Math.max(datasetMin, Math.min(num, cappedMax)); // Clamp within bounds
    })
    // Ensure slider gets the correct number of values based on operator type
    .slice(0, isRangeOperator ? 2 : 1);

  // Handle slider changes -> This changes the VALUES primarily
  const handleSliderChange = (value: number[]) => {
    const operatorToUse =
      filter?.operator ?? (isRangeOperator ? "is between" : "is");
    // Convert slider values back to strings for input display
    const newStringValues = value.map((val) =>
      val >= cappedMax ? `${cappedMax}+` : String(val),
    );
    setInputValues(newStringValues);
    // Update filter state with the numeric values from slider
    updateFilterState(operatorToUse, value);
  };

  return (
    <Command>
      <CommandList className="w-[300px] px-2 py-2">
        <CommandGroup>
          <div className="flex flex-col w-full">
            <Tabs
              // Determine current tab based on the operator type from context filter
              value={isRangeOperator ? "range" : "single"}
              onValueChange={(v) => changeType(v as "single" | "range")}
            >
              <TabsList className="w-full *:text-xs">
                <TabsTrigger value="single">Single</TabsTrigger>
                <TabsTrigger value="range">Range</TabsTrigger>
              </TabsList>

              {/* Single Value Tab */}
              <TabsContent value="single" className="flex flex-col gap-4 mt-4">
                <Slider
                  // Ensure slider gets a single value array
                  value={
                    sliderValue.length > 0 ? [sliderValue[0]] : [datasetMin]
                  }
                  onValueChange={(value) => handleSliderChange(value)} // Slider provides array
                  min={datasetMin}
                  max={cappedMax}
                  step={1}
                  aria-orientation="horizontal"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Value</span>
                  <Input
                    id="single-num-input"
                    // type="number" // Using text allows '+'
                    type="text"
                    inputMode="numeric" // Hint for mobile keyboards
                    pattern="[0-9]*" // Basic pattern for numeric input
                    value={inputValues[0] ?? ""}
                    onChange={(e) => handleInputChange(0, e.target.value)}
                    // max={cappedMax} // Max doesn't work well with text type
                    placeholder={datasetMin.toString()}
                  />
                </div>
              </TabsContent>

              {/* Range Value Tab */}
              <TabsContent value="range" className="flex flex-col gap-4 mt-4">
                <Slider
                  // Ensure slider gets two values, defaulting if necessary
                  value={
                    sliderValue.length === 2
                      ? sliderValue
                      : [datasetMin, cappedMax]
                  }
                  onValueChange={handleSliderChange}
                  min={datasetMin}
                  max={cappedMax}
                  step={1}
                  minStepsBetweenThumbs={1} // Prevent overlap if desired
                  aria-orientation="horizontal"
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Min</span>
                    <Input
                      id="range-min-input"
                      // type="number"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={inputValues[0] ?? ""}
                      onChange={(e) => handleInputChange(0, e.target.value)}
                      // max={cappedMax}
                      placeholder={datasetMin.toString()}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Max</span>
                    <Input
                      id="range-max-input"
                      type="text" // Keep as text to allow '1000+' format
                      value={inputValues[1] ?? ""}
                      placeholder={`${cappedMax}${maxFromMeta !== undefined ? "+" : ""}`} // Show + only if meta max exists
                      onChange={(e) => handleInputChange(1, e.target.value)}
                      // No max attribute here
                    />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
