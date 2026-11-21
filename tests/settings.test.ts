import test from "node:test";
import assert from "node:assert/strict";
import { MAX_NOTE_CHARS, notesSettings } from "../shared/settings";

test("scratchpad settings default to an empty note", () => {
  assert.deepEqual(notesSettings.schema.parse({}), { content: "" });
});

test("scratchpad accepts notes up to its documented limit", () => {
  assert.equal(notesSettings.schema.parse({ content: "x".repeat(MAX_NOTE_CHARS) }).content.length, MAX_NOTE_CHARS);
});

test("scratchpad rejects notes beyond its documented limit", () => {
  assert.equal(notesSettings.schema.safeParse({ content: "x".repeat(MAX_NOTE_CHARS + 1) }).success, false);
});
