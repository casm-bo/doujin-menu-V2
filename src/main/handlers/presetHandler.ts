import { ipcMain } from "electron";
import type { Preset } from "../../types/ipc.js";
import db from "../db/index.js";
import { console } from "../main.js";

export const handleGetPresets = async () => {
  try {
    const presets = await db("presets")
      .orderBy("sort_order", "asc")
      .orderBy("id", "asc")
      .select("*");
    return { success: true, data: presets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error getting presets:", error);
    return { success: false, error: message };
  }
};

export const handleAddPreset = async (
  preset: Omit<Preset, "id" | "sort_order">,
) => {
  try {
    const lastPreset = await db("presets").max("sort_order as value").first();
    const [newPreset] = await db("presets")
      .insert({ ...preset, sort_order: Number(lastPreset?.value || 0) + 1 })
      .returning("*");
    return { success: true, data: newPreset };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error adding preset:", error);
    return { success: false, error: message };
  }
};

export const handleUpdatePreset = async (preset: Preset) => {
  try {
    const { id, ...changes } = preset;
    await db("presets").where("id", id).update(changes);
    return { success: true, data: preset };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error updating preset ${preset.id}:`, error);
    return { success: false, error: message };
  }
};

export const handleDeletePreset = async (id: number) => {
  try {
    await db("presets").where("id", id).del();
    return { success: true, data: { id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error deleting preset ${id}:`, error);
    return { success: false, error: message };
  }
};

export function registerPresetHandlers() {
  ipcMain.handle("get-presets", () => handleGetPresets());
  ipcMain.handle("add-preset", (_event, preset) => handleAddPreset(preset));
  ipcMain.handle("update-preset", (_event, preset) =>
    handleUpdatePreset(preset),
  );
  ipcMain.handle("delete-preset", (_event, id) => handleDeletePreset(id));
}
