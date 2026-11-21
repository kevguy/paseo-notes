import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { NotesScreen } from "./client/notes";

function NotesItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="NotebookPen" active={currentScreen?.screenId === "notes"} onPress={() => openScreen({ screenId: "notes" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "notes", title: "Notes", Component: NotesScreen });
  client.addSidebarHeaderItem({ id: "notes", title: "Notes", Component: NotesItem });
  return () => {};
}
