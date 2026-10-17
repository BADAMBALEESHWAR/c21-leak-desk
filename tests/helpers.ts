import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateRows } from '../api/src/engine/validate';
import type { OrderRow } from '../api/src/engine/types';

export const DATA = path.resolve(__dirname, '..', 'data');

export function loadJson(rel: string): any {
  return JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
}

export function readText(rel: string): string {
  return readFileSync(path.join(DATA, rel), 'utf8');
}

export function rawOrders(rel: string): any[] {
  return loadJson(rel).records.orders;
}

export function rows(rel: string): OrderRow[] {
  return validateRows(rawOrders(rel)).rows;
}

export const FIXTURE = 'C21/fixture.json';
export const EXTENDED = 'C21_extended.json';
export const NEG = (name: string) => `negative_tests/${name}`;
export const EXPECTED = loadJson('expected.json');
