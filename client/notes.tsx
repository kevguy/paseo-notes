import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { MAX_NOTE_CHARS, notesSettings } from "../shared/settings";

type SaveStatus = "saved" | "saving" | "error";

export function NotesScreen({ theme, layout }: PluginScreenProps) {
  const settings = useSettings(notesSettings);
  const window = useWindowDimensions();
  const [text, setText] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [confirmClear, setConfirmClear] = useState(false);
  const lastSaved = useRef<string | null>(null);
  const colors = theme.colors;

  useEffect(() => {
    if (settings.status !== "ready") return;
    if (text === null || text === lastSaved.current) {
      lastSaved.current = settings.values.content;
      setText(settings.values.content);
      setSaveStatus("saved");
    }
  }, [settings.status, settings.status === "ready" ? settings.revision : ""]);

  useEffect(() => {
    if (settings.status !== "ready" || text === null || text === settings.values.content) return;
    const draft = text;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      const saved = await settings.save({ content: draft }, settings.revision);
      if (saved) {
        lastSaved.current = draft;
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [text, settings.status, settings.status === "ready" ? settings.revision : ""]);

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
  const statusText = saveStatus === "saving" || settings.saving ? "Saving…" : saveStatus === "error" || settings.saveError ? "Could not save. Your text is still here." : "Saved on this Paseo host";
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface0 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <View style={{ flex: 1, width: "100%", maxWidth: 1000, alignSelf: "center", padding: pad, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: layout.compact ? 26 : 30, fontWeight: "700" }}>Notes</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 14 }}>A quiet place for temporary thoughts.</Text>
        </View>
        {confirmClear ? <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => setConfirmClear(false)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: colors.foreground }}>Keep note</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setText(""); setConfirmClear(false); setSaveStatus("saving"); }} style={{ backgroundColor: colors.statusDanger, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: colors.accentForeground, fontWeight: "600" }}>Clear it</Text></Pressable>
        </View> : <Pressable accessibilityRole="button" accessibilityLabel="Clear notes" disabled={!text.length} onPress={() => setConfirmClear(true)} style={{ opacity: text.length ? 1 : 0.45, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: colors.foreground }}>Clear</Text></Pressable>}
      </View>

      <View style={{ flex: 1, minHeight: Math.max(280, Math.round(window.height * 0.58)), borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, overflow: "hidden" }}>
        <TextInput
          accessibilityLabel="Scratchpad notes"
          testID="notes-scratchpad"
          value={text}
          onChangeText={(value) => { setText(value); setSaveStatus("saving"); }}
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
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: saveStatus === "error" || settings.saveError ? colors.statusDanger : saveStatus === "saving" || settings.saving ? colors.foregroundMuted : colors.statusSuccess }} />
          <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 13 }}>{statusText}</Text>
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{text.length.toLocaleString()} / {MAX_NOTE_CHARS.toLocaleString()}</Text>
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Available on paired devices connected to this host. The note stays until you clear it.</Text>
    </View>
  </KeyboardAvoidingView>;
}
