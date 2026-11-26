// Mounts the real Notes screen with stub hosts and checks what each host saves when the screen closes,
// switches host or fails to save.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { createElement, act, useEffect, useLayoutEffect } = require("react");
const { create } = require("react-test-renderer");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Host components for react-native, and a useSettings bound to the host in context, like Paseo's
// (its save goes through the RPC of the host whose screen made it, even after that screen unmounts;
// saveError stays set after a failed save until the next save starts).
const stubs: Record<string, string> = {
  "react-native": `export const View = "View", Text = "Text", TextInput = "TextInput", Pressable = "Pressable", ActivityIndicator = "ActivityIndicator", KeyboardAvoidingView = "KeyboardAvoidingView";
    export const Platform = { OS: "web" };
    export function useWindowDimensions() { return { width: 1024, height: 768, scale: 1, fontScale: 1 }; }`,
  "@getpaseo/plugin/client": `import { createContext, createElement, useContext, useEffect, useState } from "react";
    const Host = createContext(null);
    export function HostProvider({ host, children }) { return createElement(Host.Provider, { value: host }, children); }
    export function useRpc(contract) {
      const host = useContext(Host);
      return (input) => contract.name.endsWith(".read") ? host.read().then((output) => contract.output.parseAsync(output)) : Promise.reject(new Error("no " + contract.name));
    }
    export function useSettings() {
      const host = useContext(Host);
      const [loaded, setLoaded] = useState(false);
      const [, render] = useState(0);
      useEffect(() => { const timer = setTimeout(() => setLoaded(true), 5); return () => clearTimeout(timer); }, [host]);
      useEffect(() => host.listen(() => render((n) => n + 1)), [host]);
      const [saving, setSaving] = useState(false);
      const [saveError, setSaveError] = useState(null);
      const save = async (values, revision) => {
        setSaving(true);
        setSaveError(null);
        const saved = await host.write(values.content, revision);
        setSaving(false);
        if (!saved) setSaveError("Could not save");
        return saved;
      };
      const rest = { saving, saveError, save, reset: async () => true, reload: async () => {} };
      return loaded ? { ...rest, status: "ready", values: { content: host.content }, revision: host.revision } : { ...rest, status: "loading" };
    }`,
};
const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: { contents: `export { NotesScreen } from "./client/notes"; export { HostProvider } from "@getpaseo/plugin/client";`, resolveDir: root, loader: "ts" },
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", logLevel: "error",
  external: ["react", "react/jsx-runtime"],
  plugins: [{
    name: "stubs",
    setup(builder) {
      builder.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: root }));
    },
  }],
});
const loaded = { exports: {} as any };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { NotesScreen, HostProvider } = loaded.exports;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SAVED = "Saved on this Paseo host";
const SAVING = "Saving…";
const FAILED = "Could not save. Your text is still here.";
const NEWER = "This host has a newer note. Your unsaved text is shown; editing it saves over that note.";

interface Host {
  id: string; content: string; revision: string; writes: string[]; landed: number; reads: number; fail: boolean; readFails: boolean; beforeRead?: () => void; onLanded?: () => void;
  listen(fn: () => void): () => void; write(content: string, revision: string): Promise<boolean>; read(): Promise<unknown>;
  external(content: string): void; hold(): { release(ok?: boolean): void };
}

/**
 * A Paseo host's stored note. `writes` holds every save this client sent it, in order; `landed` counts the ones
 * handled. Saves are handled one at a time in the order sent. `hold()` makes the next save wait until the test
 * releases it, as accepted or failed.
 */
function host(id: string, content: string): Host {
  const listeners = new Set<() => void>();
  const gates: Promise<boolean>[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let n = 1;
  const h: Host = {
    id, content, revision: `${id}-1`, writes: [], landed: 0, reads: 0, fail: false, readFails: false,
    listen(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    write(content, revision) {
      h.writes.push(content);
      const gate = gates.shift();
      const done = queue.then(async () => {
        const saved = !(gate && !(await gate)) && !h.fail && revision === h.revision;
        if (saved) h.external(content);
        h.landed++;
        h.onLanded?.();
        return saved;
      });
      queue = done;
      return done;
    },
    async read() {
      h.reads++;
      h.beforeRead?.();
      if (h.fail || h.readFails) throw new Error("offline");
      return { status: "ready", revision: h.revision, values: { content: h.content } };
    },
    /** A save from any client, such as another device. */
    external(content) {
      h.content = content;
      h.revision = `${id}-${++n}`;
      listeners.forEach((fn) => fn());
    },
    hold() {
      let release!: (ok: boolean) => void;
      gates.push(new Promise<boolean>((resolve) => (release = resolve)));
      return { release: (ok = true) => release(ok) };
    },
  };
  return h;
}

const settle = (ms: number) => act(() => sleep(ms));
async function until(check: () => boolean) {
  for (let waited = 0; !check(); waited += 10) {
    if (waited > 5000) throw new Error("timed out waiting");
    await settle(10);
  }
}
/** Runs React the way the app does, without act(): renders and effects happen in later tasks. */
async function withoutAct(run: () => Promise<void>) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await run();
  } finally {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  }
}
const screenProps = (h: Host, key = h.id) => ({ key, theme: { colors: new Proxy({}, { get: () => "#000" }) }, host: { id: h.id, label: h.id }, layout: { compact: false, platform: "web" }, params: {} });

/** One Notes screen. Paseo mounts a new screen for each host; `remounts: false` keeps one mounted. */
function screen({ remounts = true } = {}) {
  let tree: any = null;
  // Its effect cleanup runs right after the screen's, in the same pass, once the tree is unmounted.
  let cleanedUp = false;
  function Probe() {
    useEffect(() => () => void (cleanedUp = true), []);
    return null;
  }
  const input = () => tree.root.findByProps({ testID: "notes-scratchpad" });
  const press = (label: string) => act(async () => tree.root.findAll((node: any) => node.type === "Pressable" && (node.props.accessibilityLabel === label || node.findAllByType("Text")[0]?.props.children === label))[0].props.onPress());
  return {
    settle, press,
    async show(h: Host) {
      const view = createElement(HostProvider, { host: h }, createElement(NotesScreen, screenProps(h, remounts ? h.id : "")), createElement(Probe));
      await act(async () => (tree ? tree.update(view) : (tree = create(view))));
      await settle(20);
    },
    type: (text: string) => act(async () => input().props.onChangeText(text)),
    value: () => input().props.value,
    shows: (text: string) => JSON.stringify(tree.toJSON()).includes(text),
    async close() {
      await act(async () => tree.unmount());
      tree = null;
    },
    /** Unmounts outside act(), inside withoutAct(): React does it in later tasks. Resolves once the screen's cleanup ran. */
    async closeLater() {
      tree.unmount();
      tree = null;
      for (let waited = 0; !cleanedUp; waited += 5) {
        if (waited > 5000) throw new Error("timed out waiting for unmount");
        await sleep(5);
      }
    },
  };
}

test("typing then closing within 500 ms saves once, to that host", async () => {
  const a = host("close-A", "old");
  const notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "old");
  await notes.type("old and new");
  await notes.settle(100);
  await notes.close();
  await sleep(700);
  assert.deepEqual(a.writes, ["old and new"]);
  assert.equal(a.content, "old and new");
});

test("switching from host A to B within 500 ms saves to A and nothing to B", async () => {
  const a = host("switch-A", "a note");
  const b = host("switch-B", "b note");
  const notes = screen();
  await notes.show(a);
  await notes.type("a note, edited");
  await notes.settle(100);
  await notes.show(b);
  await notes.settle(700);
  assert.deepEqual(a.writes, ["a note, edited"]);
  assert.deepEqual(b.writes, []);
  assert.equal(notes.value(), "b note");
  await notes.close();
});

test("a host change that keeps the screen mounted saves to A, nothing to B, and shows B's note", async () => {
  const a = host("kept-A", "a note");
  const b = host("kept-B", "b note");
  const notes = screen({ remounts: false });
  await notes.show(a);
  await notes.type("a note, edited");
  await notes.settle(100);
  await notes.show(b);
  await notes.settle(700);
  assert.deepEqual(a.writes, ["a note, edited"]);
  assert.deepEqual(b.writes, []);
  assert.equal(notes.value(), "b note");
  await notes.close();
});

test("a failed save then close keeps the text for reopening on that host only", async () => {
  const a = host("failed-A", "saved");
  const b = host("failed-B", "b note");
  a.fail = true;
  let notes = screen();
  await notes.show(a);
  await notes.type("not saved yet");
  await notes.settle(700);
  assert.ok(notes.shows(FAILED));
  await notes.close();
  await sleep(50);

  // Another host's screen shows its own note, not the kept text.
  notes = screen();
  await notes.show(b);
  assert.equal(notes.value(), "b note");
  assert.ok(notes.shows(SAVED));
  await notes.close();

  // Reopened on A: the text and the error are back. It is not saved until edited, so it can't
  // silently replace something another device saved meanwhile.
  a.fail = false;
  const attempts = a.writes.length;
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "not saved yet");
  assert.ok(notes.shows(FAILED));
  await notes.settle(700);
  assert.equal(a.writes.length, attempts);
  assert.equal(a.content, "saved");
  await notes.type("not saved yet!");
  await notes.settle(700);
  assert.equal(a.content, "not saved yet!");
  assert.ok(notes.shows(SAVED));
  await notes.close();

  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "not saved yet!");
  assert.ok(notes.shows(SAVED));
  await notes.close();
});

test("Clear it then closing within 500 ms clears the note on that host", async () => {
  const a = host("clear-A", "something");
  const notes = screen();
  await notes.show(a);
  await notes.press("Clear notes");
  await notes.press("Clear it");
  await notes.settle(100);
  await notes.close();
  await sleep(300);
  assert.deepEqual(a.writes, [""]);
  assert.equal(a.content, "");
});

test("closing while a save is in flight also saves the text typed after it", async () => {
  const a = host("flight-newer-A", "");
  const first = a.hold();
  let notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await notes.type("xy");
  await notes.close();
  first.release();
  await until(() => a.writes.length === 2);
  await settle(20);
  assert.deepEqual(a.writes, ["x", "xy"]);
  assert.equal(a.content, "xy");
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "xy");
  assert.ok(notes.shows(SAVED));
  await notes.close();
});

test("closing while a save is in flight does not overwrite a note another device saved after it", async () => {
  const a = host("flight-other-A", "");
  const first = a.hold();
  a.beforeRead = () => a.external("theirs");
  let notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await notes.type("xy");
  await notes.close();
  first.release();
  await until(() => a.reads === 1);
  await settle(20);
  assert.deepEqual(a.writes, ["x"]);
  assert.equal(a.content, "theirs");
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "xy");
  assert.ok(notes.shows(NEWER));
  await notes.close();
});

test("an in-flight save that fails is tried once more on close", async () => {
  const a = host("flight-retry-A", "");
  const first = a.hold();
  const notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await notes.close();
  first.release(false);
  await until(() => a.writes.length === 2);
  await settle(20);
  assert.deepEqual(a.writes, ["x", "x"]);
  assert.equal(a.content, "x");
});

test("when the close save cannot read the host, it tries one save at the revision it last saw", async () => {
  // Nothing else wrote: that save goes through.
  const a = host("noread-A", "");
  const timed = a.hold();
  let notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  a.readFails = true;
  await notes.close();
  timed.release(false);
  await until(() => a.landed === 2);
  assert.deepEqual(a.writes, ["x", "x"]);
  assert.equal(a.content, "x");

  // The earlier close save moved the host on: that save conflicts, overwrites nothing, and the text is kept.
  const b = host("noread-B", "");
  const firstClose = b.hold();
  notes = screen();
  await notes.show(b);
  await notes.type("first");
  await notes.close();
  notes = screen();
  await notes.show(b);
  await notes.type("first and second");
  await until(() => b.writes.length === 2);
  b.readFails = true;
  await notes.close();
  firstClose.release();
  await until(() => b.landed === 3);
  assert.deepEqual(b.writes, ["first", "first and second", "first and second"]);
  assert.equal(b.content, "first");
  b.readFails = false;
  notes = screen();
  await notes.show(b);
  assert.equal(notes.value(), "first and second");
  assert.ok(notes.shows(FAILED));
  await notes.close();
});

test("reopening before the close save finishes shows Saving…, then the result", async () => {
  for (const ok of [true, false]) {
    const a = host(`reopen-${ok}-A`, "");
    const closeSave = a.hold();
    let notes = screen();
    await notes.show(a);
    await notes.type("x");
    await notes.close();
    notes = screen();
    await notes.show(a);
    assert.equal(notes.value(), "x");
    assert.ok(notes.shows(SAVING), a.id);
    closeSave.release(ok);
    await settle(20);
    assert.ok(notes.shows(ok ? SAVED : FAILED), a.id);
    await notes.close();
    assert.deepEqual(a.writes, ["x"]);
    assert.equal(a.content, ok ? "x" : "");
  }
});

test("a close save that fails between the reopened screen's commit and its effects still ends as an error", async () => {
  const a = host("commit-A", "");
  const closeSave = a.hold();
  const notes = screen();
  await notes.show(a);
  await notes.type("x");
  await notes.close();
  await withoutAct(async () => {
    // Fails the close save after the new screen has rendered "Saving…" but before its effects run.
    const order: string[] = [];
    a.onLanded = () => order.push("close save failed");
    function Release() {
      useLayoutEffect(() => (order.push("rendered"), closeSave.release(false)), []);
      return null;
    }
    function Effects() {
      useEffect(() => void order.push("effects"), []);
      return null;
    }
    const tree = create(createElement(HostProvider, { host: a }, createElement(Release), createElement(NotesScreen, screenProps(a)), createElement(Effects)));
    const shown = () => JSON.stringify(tree.toJSON());
    for (let waited = 0; !shown().includes(FAILED) && waited < 2000; waited += 10) await sleep(10);
    const result = shown();
    tree.unmount();
    await sleep(20);
    assert.deepEqual(order, ["rendered", "close save failed", "effects"]);
    assert.ok(result.includes(FAILED), result.includes(SAVING) ? "still shows Saving…" : result);
  });
});

test("closing again while the first close save is running saves the newer text after it", async () => {
  const a = host("again-A", "");
  const firstClose = a.hold();
  let notes = screen();
  await notes.show(a);
  await notes.type("first");
  await notes.close();
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "first");
  await notes.type("first and second");
  await notes.close();
  firstClose.release();
  await until(() => a.writes.length === 2);
  await settle(20);
  assert.deepEqual(a.writes, ["first", "first and second"]);
  assert.equal(a.content, "first and second");
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "first and second");
  assert.ok(notes.shows(SAVED));
  await notes.close();
});

test("closing after a timed save while the first close save is still running saves the newer text after both", async () => {
  const a = host("both-A", "");
  const firstClose = a.hold();
  let notes = screen();
  await notes.show(a);
  await notes.type("first");
  await notes.close();
  notes = screen();
  await notes.show(a);
  await notes.type("first and second");
  // The timed save goes out at the revision this screen saw, behind the first close save.
  await until(() => a.writes.length === 2);
  await notes.close();
  firstClose.release();
  await until(() => a.landed === 3);
  assert.deepEqual(a.writes, ["first", "first and second", "first and second"]);
  assert.equal(a.content, "first and second");
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "first and second");
  assert.ok(notes.shows(SAVED));
  await notes.close();
});

test("a save that finishes while a newer edit is being saved leaves the status on Saving…", async () => {
  const a = host("latest-A", "");
  const first = a.hold();
  const second = a.hold();
  const notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await notes.type("xy");
  await until(() => a.writes.length === 2);
  first.release();
  await until(() => a.landed === 1);
  await settle(20);
  assert.ok(notes.shows(SAVING));
  second.release();
  await until(() => a.content === "xy");
  await settle(20);
  assert.ok(notes.shows(SAVED));
  await notes.close();
});

test("closing right after a timed save lands, before the screen re-renders, sends nothing more", async () => {
  const a = host("landed-A", "");
  const timed = a.hold();
  const notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await withoutAct(async () => {
    timed.release();
    for (let i = 0; a.landed === 0; i++) {
      assert.ok(i < 1000, "the save never landed");
      await Promise.resolve();
    }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // The save has landed and the screen has not re-rendered since, so this close is the case under test.
    assert.ok(notes.shows(SAVING));
    await notes.closeLater();
  });
  assert.deepEqual(a.writes, ["x"]);
  assert.equal(a.content, "x");
});

test("kept text over a note another device saved since says so", async () => {
  const a = host("newer-A", "first");
  a.fail = true;
  let notes = screen();
  await notes.show(a);
  await notes.type("mine");
  await notes.settle(700);
  await notes.close();
  await sleep(50);
  a.fail = false;
  a.external("theirs");
  const attempts = a.writes.length;
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "mine");
  assert.ok(notes.shows(NEWER));
  await notes.settle(700);
  assert.equal(a.writes.length, attempts);
  assert.equal(a.content, "theirs");
  await notes.close();
});

test("after a failed save, typing back to the saved text shows it as saved", async () => {
  const a = host("back-A", "abc");
  a.fail = true;
  const notes = screen();
  await notes.show(a);
  await notes.type("abcd");
  await until(() => a.writes.length === 1);
  await settle(20);
  assert.ok(notes.shows(FAILED));
  a.fail = false;
  await notes.type("abc");
  await settle(20);
  assert.ok(notes.shows(SAVED));
  await notes.close();
  await sleep(50);
  assert.deepEqual(a.writes, ["abcd"]);
});

test("typing back to the stored text while its save fails shows it as saved", async () => {
  const a = host("back-fail-A", "abc");
  const timed = a.hold();
  const notes = screen();
  await notes.show(a);
  await notes.type("abcd");
  await until(() => a.writes.length === 1);
  await notes.type("abc");
  timed.release(false);
  await until(() => a.landed === 1);
  await settle(20);
  assert.ok(notes.shows(SAVED), notes.shows(SAVING) ? "still shows Saving…" : "");
  assert.equal(a.content, "abc");
  await notes.close();
  await sleep(50);
  assert.deepEqual(a.writes, ["abcd"]);
});

test("typing back to the saved text shows it as saved", async () => {
  const a = host("same-A", "abc");
  const notes = screen();
  await notes.show(a);
  await notes.type("abcd");
  await notes.settle(100);
  await notes.type("abc");
  await notes.settle(700);
  assert.ok(notes.shows(SAVED));
  await notes.close();
  await sleep(50);
  assert.deepEqual(a.writes, []);
});

// These already worked and must keep working.
test("typing still saves once after a 500 ms pause, and closing then saves nothing more", async () => {
  const a = host("debounce-A", "");
  const notes = screen();
  await notes.show(a);
  await notes.type("a");
  await notes.settle(100);
  await notes.type("ab");
  await notes.settle(100);
  await notes.type("abc");
  await notes.settle(700);
  assert.deepEqual(a.writes, ["abc"]);
  assert.ok(notes.shows(SAVED));
  await notes.close();
  await sleep(100);
  assert.deepEqual(a.writes, ["abc"]);
});

test("closing while a save is in flight saves once and keeps nothing for reopening", async () => {
  const a = host("flight-A", "");
  const timed = a.hold();
  let notes = screen();
  await notes.show(a);
  await notes.type("x");
  await until(() => a.writes.length === 1);
  await notes.close();
  timed.release();
  await settle(20);
  assert.deepEqual(a.writes, ["x"]);
  notes = screen();
  await notes.show(a);
  assert.equal(notes.value(), "x");
  assert.ok(notes.shows(SAVED));
  await notes.close();
});
