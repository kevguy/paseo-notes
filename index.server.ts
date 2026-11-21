import type { PluginServerContext } from "@getpaseo/plugin/server";
import { notesSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(notesSettings);
  return () => {};
}
