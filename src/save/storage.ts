import { del, get, set } from 'idb-keyval';
import type { SaveData } from '../sim/serialize';

const KEY = 'colony-save-v1';

/** Файл сохранения: мир плюс то, что относится только к отображению. */
export interface SaveFile {
  sim: SaveData;
  camera: { x: number; y: number; zoom: number };
  savedAt: number;
}

export async function saveGame(file: SaveFile): Promise<boolean> {
  try {
    await set(KEY, file);
    return true;
  } catch (e) {
    console.warn('Не удалось сохранить игру', e);
    return false;
  }
}

export async function loadGame(): Promise<SaveFile | null> {
  try {
    const v = (await get(KEY)) as SaveFile | undefined;
    return v ?? null;
  } catch (e) {
    console.warn('Не удалось прочитать сохранение', e);
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await del(KEY);
  } catch (e) {
    console.warn('Не удалось удалить сохранение', e);
  }
}
