import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_NOTE_CHARS = 50_000;

export const notesSettings = defineSettings({
  id: "paseo-notes-scratchpad",
  scope: "host",
  version: 1,
  schema: z.object({ content: z.string().max(MAX_NOTE_CHARS).default("") }),
});
