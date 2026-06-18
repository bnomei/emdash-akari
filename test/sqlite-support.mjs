import { DatabaseSync } from "node:sqlite";

export function sqliteSupportsFts5() {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec("CREATE VIRTUAL TABLE __akari_fts_probe USING fts5(value);");
    return true;
  } catch (error) {
    if (error?.message?.includes("no such module: fts5")) return false;
    throw error;
  } finally {
    db.close();
  }
}
