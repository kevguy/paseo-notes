import React from "react";
import { createRoot } from "react-dom/client";
import { NotesScreen } from "../../client/notes";

const colors = {
  foreground: "#20232a", foregroundMuted: "#69717d", accent: "#6251d5", accentForeground: "#ffffff",
  surface0: "#ffffff", surface1: "#f6f6f9", surface2: "#e9eaf0", border: "#d9dce3",
  statusSuccess: "#26824c", statusDanger: "#b42318",
};
const theme = { id: "notes-preview", name: "Notes preview", colors } as any;
const params = new URLSearchParams(window.location.search);
const props = { theme, layout: { compact: params.has("mobile"), platform: params.has("mobile") ? "android" : "web" }, params: {} } as any;
createRoot(document.getElementById("root")!).render(<NotesScreen {...props} />);
