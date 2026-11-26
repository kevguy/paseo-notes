import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { settingsRpc } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { MAX_NOTE_CHARS, notesSettings } from "../shared/settings";

type SaveStatus = "saved" | "saving" | "error" | "newer";

/** Text a host has not confirmed, the host's note it was written over, and the close save still running. */
interface Kept { text: string; base: string | null; pending: Promise<boolean> | null }

// Kept text by host and setting, so closing Notes or switching host doesn't lose it. The next Notes
// screen on that host takes it. Memory only: it lasts until the app or plugin reloads.
const unsaved = new Map<string, Kept>();
const readNote = settingsRpc(notesSettings.id).read;

function keep(key: string, entry: Kept, pending: Promise<boolean>) {
  entry.pending = pending;
  void pending.then((saved) => {
    entry.pending = null;
    if (saved && unsaved.get(key) === entry) unsaved.delete(key);
  });
}

export function NotesScreen(props: PluginScreenProps) {
  // A new screen for each host, even if Paseo keeps this one mounted.
  return <Notes key={props.host.id} {...props} />;
}

function Notes({ theme, layout, host }: PluginScreenProps) {
  const settings = useSettings(notesSettings);
  // Like `settings.save`, bound to this screen's host.
  const read = useRpc(readNote);
  const window = useWindowDimensions();
  const key = `${host.id}\n${notesSettings.id}`;
  const [kept] = useState(() => unsaved.get(key) ?? null);
  // The close save still running when this screen opened. Read once: keep() clears `kept.pending` when it ends.
  const [closePending] = useState(() => kept?.pending ?? null);
  const [text, setText] = useState<string | null>(kept?.text ?? null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(closePending ? "saving" : kept ? "error" : "saved");
  const [confirmClear, setConfirmClear] = useState(false);
  const lastSaved = useRef<string | null>(null);
  // Kept text is not saved again until it is edited. If another device changed the note since, the status says so.
  const held = useRef(kept !== null);
  const closeSaving = useRef(closePending !== null);
  const inFlight = useRef<{ draft: string; done: Promise<boolean> } | null>(null);
  const latest = useRef({ text, settings, read });
  const colors = theme.colors;
  const keptStatus = (content: string): SaveStatus => kept?.base == null || content === kept.base ? "error" : "newer";

  useEffect(() => {
    latest.current = { text, settings, read };
  });

  useEffect(() => {
    if (!kept) return;
    unsaved.delete(key);
    void closePending?.then((saved) => {
      closeSaving.current = false;
      if (!held.current) return;
      const { settings } = latest.current;
      if (saved) held.current = false;
      setSaveStatus(saved ? "saved" : settings.status === "ready" ? keptStatus(settings.values.content) : "error");
    });
  }, []);

  useEffect(() => {
    if (settings.status !== "ready") return;
    if (text === null || text === lastSaved.current || text === settings.values.content) {
      lastSaved.current = settings.values.content;
      held.current = false;
      setText(settings.values.content);
      setSaveStatus("saved");
    } else if (held.current && !closeSaving.current) {
      setSaveStatus(keptStatus(settings.values.content));
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : ""]);

  useEffect(() => {
    if (settings.status !== "ready" || text === null || held.current) return;
    if (text === settings.values.content) {
      if (!inFlight.current) setSaveStatus("saved");
      return;
    }
    const draft = text;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      const done = settings.save({ content: draft }, settings.revision);
      inFlight.current = { draft, done };
      const saved = await done;
      if (inFlight.current?.done === done) inFlight.current = null;
      if (saved) lastSaved.current = draft;
      // After a newer edit, the status belongs to that edit's save, unless the edit went back to the stored
      // text: then nothing more is saved, and as this save failed the host still has that text.
      const now = latest.current;
      if (now.text === draft) setSaveStatus(saved ? "saved" : "error");
      else if (!saved && !inFlight.current && now.settings.status === "ready" && now.text === now.settings.values.content) setSaveStatus("saved");
    }, 500);
    return () => clearTimeout(timer);
  }, [text, settings.status, settings.status === "ready" ? settings.revision : ""]);

  // On close or host switch, save what the timer had not saved yet, to this screen's host only:
  // `save` and `read` are bound to the host this screen was showing. Keep the text until that host confirms it.
  useEffect(() => () => {
    const { text, settings, read } = latest.current;
    const known = settings.status === "ready" ? settings.values.content : lastSaved.current;
    if (text === null || text === known || text === lastSaved.current) {
      unsaved.delete(key);
      return;
    }
    const entry: Kept = { text, base: known, pending: null };
    unsaved.set(key, entry);
    if (held.current) {
      // Still the kept text, unedited: pass it on as it came, with any close save still running.
      entry.base = kept?.base ?? null;
      if (closePending && closeSaving.current) keep(key, entry, closePending);
      return;
    }
    if (settings.status !== "ready") return;
    const { save, revision } = settings;
    // Saves whose result this screen hasn't seen: the close save it opened with, then its own timed save.
    const opened = closePending && closeSaving.current ? closePending : null;
    const own = inFlight.current;
    const seen = lastSaved.current;
    if (!opened && !own) {
      keep(key, entry, save({ content: text }, revision));
      return;
    }
    keep(key, entry, (async () => {
      const openedSaved = (await opened) === true;
      const ownSaved = (await own?.done) === true;
      if (ownSaved && own?.draft === text) return true;
      // What the host holds if no other device wrote since; it may be at a revision this screen never saw.
      const ours = ownSaved && own ? [own.draft] : openedSaved && kept ? [kept.text] : [seen, known];
      entry.base = ours[0] ?? known;
      const current = await read({}).catch(() => null);
      if (!current) return save({ content: text }, revision);
      if (current.status !== "ready") return false;
      const content = (current.values as { content?: unknown } | null)?.content;
      if (content === text) return true;
      return typeof content === "string" && ours.includes(content) ? save({ content: text }, current.revision) : false;
    })());
  }, []);

  if (settings.status === "loading" || text === null) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface0 }}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (settings.status !== "ready") {
    const message = settings.status === "error" ? settings.error : settings.error;
    return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12, backgroundColor: colors.surface0 }}>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "600" }}>Notes could not load</Text>
      <Text style={{ color: colors.foregroundMuted, textAlign: "center" }}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={() => void settings.reload()} style={{ backgroundColor: colors.accent, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 10 }}><Text style={{ color: colors.accentForeground, fontWeight: "600" }}>Try again</Text></Pressable>
    </View>;
  }

  const pad = layout.compact ? 16 : 28;
  // From saveStatus only: settings.saveError stays set after a failed save until the next save starts.
  const statusText = saveStatus === "saving" ? "Saving…" : saveStatus === "newer" ? "This host has a newer note. Your unsaved text is shown; editing it saves over that note." : saveStatus === "error" ? "Could not save. Your text is still here." : "Saved on this Paseo host";
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface0 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={{ flex: 1, width: "100%", maxWidth: 1000, alignSelf: "center", padding: pad, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: layout.compact ? 26 : 30, fontWeight: "700" }}>Notes</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 14 }}>A quiet place for temporary thoughts.</Text>
        </View>
        {confirmClear ? <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => setConfirmClear(false)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: colors.foreground }}>Keep note</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => { held.current = false; setText(""); setConfirmClear(false); setSaveStatus("saving"); }} style={{ backgroundColor: colors.statusDanger, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: colors.accentForeground, fontWeight: "600" }}>Clear it</Text></Pressable>
        </View> : <Pressable accessibilityRole="button" accessibilityLabel="Clear notes" disabled={!text.length} onPress={() => setConfirmClear(true)} style={{ opacity: text.length ? 1 : 0.45, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: colors.foreground }}>Clear</Text></Pressable>}
      </View>

      <View style={{ flex: 1, minHeight: Math.max(280, Math.round(window.height * 0.58)), borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden" }}>
        <TextInput
          accessibilityLabel="Scratchpad notes"
          testID="notes-scratchpad"
          value={text}
          onChangeText={(value) => { held.current = false; setText(value); setSaveStatus("saving"); }}
          placeholder="Type a note…"
          placeholderTextColor={colors.foregroundMuted}
          multiline
          maxLength={MAX_NOTE_CHARS}
          autoCapitalize="sentences"
          autoCorrect
          textAlignVertical="top"
          style={{ flex: 1, padding: layout.compact ? 16 : 22, color: colors.foreground, fontSize: 17, lineHeight: 27 }}
        />
      </View>

      {confirmClear && <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted }}>Clear the saved scratchpad on this Paseo host?</Text>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 7 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: saveStatus === "error" || saveStatus === "newer" ? colors.statusDanger : saveStatus === "saving" ? colors.foregroundMuted : colors.statusSuccess }} />
          <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 13 }}>{statusText}</Text>
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text.length.toLocaleString()} / {MAX_NOTE_CHARS.toLocaleString()}</Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Available on paired devices connected to this host. The note stays until you clear it.</Text>
    </View>
  </KeyboardAvoidingView>;
}
