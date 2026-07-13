/**
 * The Documents library, in IndexedDB.
 *
 * There is no server and no account. Everything -- the feature trees, the version
 * graphs, the source meshes -- lives in this browser. That is not a limitation
 * dressed up as a virtue: it is the reason you can drop a proprietary part file in
 * here without it ever leaving your machine, and the reason the whole thing hosts
 * free on GitHub Pages forever.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { Feature, VersionGraph } from '@slipcast/engine';

export interface DocumentRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  features: Feature[];
  versions: VersionGraph;
  /** Key into the `files` table. */
  fileId: string;
  /** A small PNG data URL for the Documents page. */
  thumbnail?: string;
  trashed?: boolean;
}

export interface FileRecord {
  id: string;
  name: string;
  bytes: ArrayBuffer;
}

const db = new Dexie('slipcast') as Dexie & {
  documents: EntityTable<DocumentRecord, 'id'>;
  files: EntityTable<FileRecord, 'id'>;
};

db.version(1).stores({
  documents: 'id, name, updatedAt, trashed',
  files: 'id',
});

export { db };

export function newId(): string {
  return crypto.randomUUID();
}

export async function listDocuments(includeTrashed = false): Promise<DocumentRecord[]> {
  const all = await db.documents.orderBy('updatedAt').reverse().toArray();
  return includeTrashed ? all : all.filter((d) => !d.trashed);
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  await db.documents.put({ ...doc, updatedAt: Date.now() });
}

export async function loadFile(fileId: string): Promise<FileRecord | undefined> {
  return db.files.get(fileId);
}

export async function storeFile(name: string, bytes: ArrayBuffer): Promise<string> {
  const id = newId();
  await db.files.put({ id, name, bytes });
  return id;
}

/** Trash is recoverable; a mold you spent an hour tuning should not vanish on a mis-click. */
export async function trashDocument(id: string): Promise<void> {
  await db.documents.update(id, { trashed: true, updatedAt: Date.now() });
}

export async function restoreDocument(id: string): Promise<void> {
  await db.documents.update(id, { trashed: false, updatedAt: Date.now() });
}

export async function deleteForever(id: string): Promise<void> {
  const doc = await db.documents.get(id);
  if (doc) await db.files.delete(doc.fileId);
  await db.documents.delete(id);
}
