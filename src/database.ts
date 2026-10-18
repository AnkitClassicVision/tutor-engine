import type { DatabaseSync } from 'node:sqlite'

export type Row = Record<string, any>
export interface AsyncDatabase {
  readonly dialect: 'postgres'
  readonly isTransaction: boolean
  prepare(sql: string): {
    get(...values: any[]): Promise<Row | undefined>
    all(...values: any[]): Promise<Row[]>
    run(...values: any[]): Promise<{ changes: number }>
  }
  exec(sql: string): Promise<void>
}
export type Database = DatabaseSync | AsyncDatabase
