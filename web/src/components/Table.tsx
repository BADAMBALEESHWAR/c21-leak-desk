import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface Column<T> {
  id: string;
  header: ReactNode;
  align?: 'left' | 'right';
  cell: (row: T) => ReactNode;
  footer?: ReactNode;
  /** Render this column's cells as <th scope="row">. */
  rowHeader?: boolean;
  className?: string;
}

interface TableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Rows appended after the data rows, e.g. a channel spend line. */
  extraRows?: ReactNode;
  /** Bounded, scrollable sheet (sticky header stays in view inside it). */
  sheet?: boolean;
  emptyText?: string;
  className?: string;
}

export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  extraRows,
  sheet = false,
  emptyText,
  className,
}: TableProps<T>) {
  const { t } = useTranslation();
  const hasFooter = columns.some((c) => c.footer !== undefined);
  const alignCls = (c: Column<T>) => [c.align === 'right' ? 'r' : undefined, c.className].filter(Boolean).join(' ') || undefined;

  const handleClick = (row: T) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    // Buttons and links inside the row handle their own clicks.
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    onRowClick(row);
  };

  return (
    <div className={['table-wrap', sheet ? 'table-sheet' : undefined, className].filter(Boolean).join(' ')}>
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={alignCls(c)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !extraRows ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {emptyText ?? t('table.noRows', 'No rows.')}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? handleClick(row) : undefined}
              className={[onRowClick ? 'clickable' : undefined, rowClassName?.(row)].filter(Boolean).join(' ') || undefined}
            >
              {columns.map((c) =>
                c.rowHeader ? (
                  <th key={c.id} scope="row" className={alignCls(c)}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.id} className={alignCls(c)}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
          {extraRows}
        </tbody>
        {hasFooter ? (
          <tfoot>
            <tr>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.id} scope="row" className={alignCls(c)}>
                    {c.footer}
                  </th>
                ) : (
                  <td key={c.id} className={alignCls(c)}>
                    {c.footer}
                  </td>
                ),
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
