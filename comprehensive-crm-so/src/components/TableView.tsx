import { useState, useEffect, useMemo } from 'react'
import { useKV } from '@/lib/spark-mock'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { CheckCirclebox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  ArrowUp,
  ArrowDown,
  Funnel,
  SortAscending,
  SortDescending,
  Eye,
  EyeSlash,
  DotsThree,
  Plus,
  Download,
  Upload,
  Gear
} from "@phosphor-icons/react"

interface TableColumn {
  id: string
  name: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'avatar' | 'badge'
  width?: number
  visible: boolean
  sortable: boolean
  filterable: boolean
  position: number
}

interface TableFunnel {
  columnId: string
  operator: 'equals' | 'contains' | 'starts_with' | 'greater_than' | 'less_than'
  value: any
}

interface TableSort {
  columnId: string
  direction: 'asc' | 'desc'
}

interface TableViewProps {
  data: any[]
  columns: TableColumn[]
  title: string
  description?: string
  onRowClick?: (row: any) => void
  onRowSelect?: (selectedRows: any[]) => void
  actions?: {
    create?: () => void
    export?: () => void
    import?: () => void
    delete?: (rows: any[]) => void
  }
}

export function TableView({
  data,
  columns: initialColumns,
  title,
  description,
  onRowClick,
  onRowSelect,
  actions
}: TableViewProps) {
  const [columns, setColumns] = useKV<TableColumn[]>(`table-columns-${title}`, initialColumns)
  const [filters, setFunnels] = useState<TableFunnel[]>([])
  const [sort, setSort] = useState<TableSort | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [searchQuery, setMagnifyingGlassQuery] = useState('')

  // Apply filters and sorting to data
  const processedData = useMemo(() => {
    let filtered = data

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(row =>
        Object.values(row).some(value =>
          String(value).toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    }

    // Apply filters
    filters.forEach(filter => {
      filtered = filtered.filter(row => {
        const value = row[filter.columnId]
        switch (filter.operator) {
          case 'equals':
            return value === filter.value
          case 'contains':
            return String(value).toLowerCase().includes(String(filter.value).toLowerCase())
          case 'starts_with':
            return String(value).toLowerCase().startsWith(String(filter.value).toLowerCase())
          case 'greater_than':
            return Number(value) > Number(filter.value)
          case 'less_than':
            return Number(value) < Number(filter.value)
          default:
            return true
        }
      })
    })

    // Apply sorting
    if (sort) {
      filtered = [...filtered].sort((a, b) => {
        const aValue = a[sort.columnId]
        const bValue = b[sort.columnId]

        if (aValue < bValue) return sort.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sort.direction === 'asc' ? 1 : -1
        return 0
      })
    }

    return filtered
  }, [data, filters, sort, searchQuery])

  // Visible columns sorted by position
  const visibleColumns = useMemo(() => {
    return columns
      .filter(col => col.visible)
      .sort((a, b) => a.position - b.position)
  }, [columns])

  const handleSort = (columnId: string) => {
    if (sort?.columnId === columnId) {
      setSort({
        columnId,
        direction: sort.direction === 'asc' ? 'desc' : 'asc'
      })
    } else {
      setSort({ columnId, direction: 'asc' })
    }
  }

  const handleRowSelection = (rowId: string, selected: boolean) => {
    const newSelected = new Set(selectedRows)
    if (selected) {
      newSelected.add(rowId)
    } else {
      newSelected.delete(rowId)
    }
    setSelectedRows(newSelected)

    if (onRowSelect) {
      const selectedData = processedData.filter(row => newSelected.has(row.id))
      onRowSelect(selectedData)
    }
  }

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      const allIds = new Set(processedData.map(row => row.id))
      setSelectedRows(allIds)
      if (onRowSelect) {
        onRowSelect(processedData)
      }
    } else {
      setSelectedRows(new Set())
      if (onRowSelect) {
        onRowSelect([])
      }
    }
  }

  const toggleColumnVisibility = (columnId: string) => {
    setColumns(prevColumns =>
      prevColumns.map(col =>
        col.id === columnId ? { ...col, visible: !col.visible } : col
      )
    )
  }

  const renderCellContent = (row: any, column: TableColumn) => {
    const value = row[column.name]

    switch (column.type) {
      case 'avatar':
        return (
          <Avatar className="h-8 w-8">
            <AvatarImage src={value?.url} />
            <AvatarFallback>
              {value?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || '??'}
            </AvatarFallback>
          </Avatar>
        )

      case 'badge':
        return (
          <Badge variant={value?.variant || 'secondary'} className={value?.className}>
            {value?.text || value}
          </Badge>
        )

      case 'boolean':
        return (
          <Badge variant={value ? 'default' : 'secondary'}>
            {value ? 'Sim' : 'Não'}
          </Badge>
        )

      case 'date':
        return value ? new Date(value).toLocaleDateString('pt-BR') : '-'

      case 'number':
        return typeof value === 'number' ? value.toLocaleString('pt-BR') : value

      default:
        return value || '-'
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{title}</h2>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {actions?.create && (
            <Button onClick={actions.create}>
              <Plus className="h-4 w-4 mr-2" />
              Novo
            </Button>
          )}

          {actions?.export && (
            <Button variant="outline" onClick={actions.export}>
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
          )}

          {actions?.import && (
            <Button variant="outline" onClick={actions.import}>
              <Upload className="h-4 w-4 mr-2" />
              Importar
            </Button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {/* MagnifyingGlass */}
          <Input
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setMagnifyingGlassQuery(e.target.value)}
            className="w-64"
          />

          {/* Funnel Button */}
          <Button variant="outline" size="sm">
            <Funnel className="h-4 w-4 mr-2" />
            Filtros
            {filters.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {filters.length}
              </Badge>
            )}
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          {/* Selected Actions */}
          {selectedRows.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {selectedRows.size} selecionado(s)
              </span>
              {actions?.delete && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const selectedData = processedData.filter(row => selectedRows.has(row.id))
                    actions.delete!(selectedData)
                  }}
                >
                  Excluir
                </Button>
              )}
            </>
          )}

          {/* Column Visibility */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Gear className="h-4 w-4 mr-2" />
                Colunas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {columns.map(column => (
                <DropdownMenuItem
                  key={column.id}
                  onClick={() => toggleColumnVisibility(column.id)}
                  className="flex items-center justify-between"
                >
                  <span>{column.label}</span>
                  {column.visible ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeSlash className="h-4 w-4" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Select All CheckCirclebox */}
                <TableHead className="w-12">
                  <CheckCirclebox
                    checked={selectedRows.size === processedData.length && processedData.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>

                {/* Column Headers */}
                {visibleColumns.map(column => (
                  <TableHead
                    key={column.id}
                    className={column.sortable ? 'cursor-pointer hover:bg-accent/50' : ''}
                    onClick={column.sortable ? () => handleSort(column.name) : undefined}
                    style={{ width: column.width }}
                  >
                    <div className="flex items-center space-x-2">
                      <span>{column.label}</span>
                      {column.sortable && (
                        <div className="flex flex-col">
                          {sort?.columnId === column.name ? (
                            sort.direction === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <SortAscending className="h-3 w-3 opacity-50" />
                          )}
                        </div>
                      )}
                    </div>
                  </TableHead>
                ))}

                {/* Actions Column */}
                <TableHead className="w-12">
                  <DotsThree className="h-4 w-4" />
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {processedData.map(row => (
                <TableRow
                  key={row.id}
                  className={`${onRowClick ? 'cursor-pointer' : ''} ${selectedRows.has(row.id) ? 'bg-accent/50' : ''
                    }`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {/* Row CheckCirclebox */}
                  <TableCell>
                    <CheckCirclebox
                      checked={selectedRows.has(row.id)}
                      onCheckedChange={(checked) => handleRowSelection(row.id, checked as boolean)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>

                  {/* Data Cells */}
                  {visibleColumns.map(column => (
                    <TableCell key={`${row.id}-${column.id}`}>
                      {renderCellContent(row, column)}
                    </TableCell>
                  ))}

                  {/* Actions */}
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                          <DotsThree className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Editar</DropdownMenuItem>
                        <DropdownMenuItem>Duplicar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Empty State */}
          {processedData.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {searchQuery || filters.length > 0
                  ? "Nenhum resultado encontrado"
                  : "Nenhum dado disponível"
                }
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table Footer */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Mostrando {processedData.length} de {data.length} registros
        </div>
        <div>
          {selectedRows.size > 0 && `${selectedRows.size} selecionado(s)`}
        </div>
      </div>
    </div>
  )
}
