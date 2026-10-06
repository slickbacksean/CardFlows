import {
  CONDITION_LABELS,
  DISCLOSURE_ITEMS,
  appendSnippet,
  computeCostToAskSpread,
  INVALID_DOLLAR_AMOUNT,
  parseDollarsToCents,
  disclosureSnippet,
  readyForReviewMissing,
  type DisclosureAnswers,
  type ListingDraft,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/ui/primary-button";
import {
  getDraft,
  getDraftClipboard,
  isWatchlistDraftBlockedError,
  markDraftReady,
  patchDraft,
} from "@/lib/api";
import { colors, space } from "@/lib/theme";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isWatchlistBlockedRoute(draftId: string | undefined, blocked: string | undefined) {
  return draftId === "watchlist" || blocked === "watchlist";
}

export default function DraftScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId: string; blocked?: string }>();
  const draftId = firstParam(params.draftId);
  const blocked = firstParam(params.blocked);
  const routeBlocked = isWatchlistBlockedRoute(draftId, blocked);

  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [condition, setCondition] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [channelNote, setChannelNote] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [allInTotal, setAllInTotal] = useState<string | null>(null);
  const [disclosure, setDisclosure] = useState<DisclosureAnswers>({});
  const [status, setStatus] = useState<ListingDraft["status"]>("draft");
  const [error, setError] = useState<string | null>(null);
  const [readyNotice, setReadyNotice] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copyDisclaimer, setCopyDisclaimer] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);
  const [isWatchlistBlocked, setIsWatchlistBlocked] = useState(routeBlocked);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(!routeBlocked);
  const [routeBlockedSeen, setRouteBlockedSeen] = useState(routeBlocked);
  if (routeBlockedSeen !== routeBlocked) {
    setRouteBlockedSeen(routeBlocked);
    setIsWatchlistBlocked(routeBlocked);
    setIsLoading(!routeBlocked);
  }

  function applyView(next: ListingDraft, nextAllIn: string | null) {
    setDraft(next);
    setTitle(next.title);
    setDescription(next.description);
    setCondition(next.condition ?? "");
    setAskingPrice(next.askingPrice ?? "");
    setNotes(next.notes);
    setChannelNote(next.intendedChannelNote);
    setStatus(next.status);
    setAllInTotal((current) => nextAllIn ?? current);
    setReadyNotice(
      next.status === "ready_for_review"
        ? "Ready for review. CardFlow did not publish this."
        : null,
    );
  }

  useEffect(() => {
    if (routeBlocked) return;

    let cancelled = false;
    async function load() {
      if (!draftId) {
        setError("Draft not found");
        setIsLoading(false);
        return;
      }
      try {
        const result = await getDraft(draftId);
        if (cancelled) return;
        applyView(
          result.draft,
          result.allInTotal ?? result.costToAsk?.allInTotal ?? null,
        );
        setChips(result.keywordChips ?? []);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        if (isWatchlistDraftBlockedError(caught)) {
          setIsWatchlistBlocked(true);
        } else {
          setError(caught instanceof Error ? caught.message : "Draft not found");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [blocked, draftId, routeBlocked]);

  const catalog = draft?.catalogDisplay;
  const liveSpread = useMemo(
    () =>
      computeCostToAskSpread({
        askingPrice: askingPrice.trim() || null,
        allInTotal,
        currency: draft?.currency,
      }),
    [allInTotal, askingPrice, draft?.currency],
  );
  const missing = useMemo(
    () =>
      readyForReviewMissing({
        title,
        condition: condition.trim() || null,
        askingPrice: askingPrice.trim() || null,
      }),
    [askingPrice, condition, title],
  );
  const canMarkReady = missing.length === 0;
  const disclosureText = useMemo(() => disclosureSnippet(disclosure), [disclosure]);
  const keywordChips = useMemo(() => {
    if (!condition.trim() || chips.includes(condition)) return chips;
    return [...chips, condition];
  }, [chips, condition]);

  const headerTitle =
    status === "ready_for_review" ? "Draft · ready for review" : "Draft · internal";

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/collection");
  }

  function goToInventory() {
    router.replace({
      pathname: "/(tabs)/collection",
      params: { segment: "purchased" },
    });
  }

  async function save(extra?: Parameters<typeof patchDraft>[1]) {
    if (!draftId) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof patchDraft>[1] = {
        description,
        condition: condition.trim() || null,
        askingPrice: askingPrice.trim() || null,
        notes,
        intendedChannelNote: channelNote,
        ...extra,
      };
      if (!extra?.titleTemplateId) payload.title = title;
      const result = await patchDraft(draftId, payload);
      applyView(
        result.draft,
        result.allInTotal ?? result.costToAsk?.allInTotal ?? null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function onReady() {
    if (!draftId || !canMarkReady) return;
    setIsSaving(true);
    setError(null);
    try {
      await patchDraft(draftId, {
        title,
        description,
        condition: condition.trim() || null,
        askingPrice: askingPrice.trim() || null,
        notes,
        intendedChannelNote: channelNote,
      });
      const result = await markDraftReady(draftId);
      applyView(
        result.draft,
        result.allInTotal ?? result.costToAsk?.allInTotal ?? null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not mark ready");
    } finally {
      setIsSaving(false);
    }
  }

  async function onCopy() {
    if (!draftId) return;
    setError(null);
    try {
      await patchDraft(draftId, {
        title,
        description,
        condition: condition.trim() || null,
        askingPrice: askingPrice.trim() || null,
        notes,
        intendedChannelNote: channelNote,
      });
      const result = await getDraftClipboard(draftId);
      await Clipboard.setStringAsync(result.clipboard.plainText);
      setHasCopied(true);
      setCopyNotice(
        "Copied title, description, condition, and asking price. Private notes omitted.",
      );
      setCopyDisclaimer(result.clipboard.disclaimer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Copy failed");
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={goBack}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={28} />
        </Pressable>
        <Text numberOfLines={1} style={styles.topTitle}>
          {isWatchlistBlocked || (!draft && !isLoading) ? "Draft" : headerTitle}
        </Text>
        <View style={styles.iconButton} />
      </View>

      {isWatchlistBlocked ? (
        <View style={styles.blocked}>
          <Text style={styles.title}>Watchlist cannot draft.</Text>
          <Text style={styles.body}>Save as Purchased first.</Text>
          <PrimaryButton label="Back to inventory" onPress={goToInventory} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {isLoading && !draft ? <Text style={styles.body}>Loading draft…</Text> : null}
            {!draft && error ? <Text style={styles.error}>{error}</Text> : null}

            {draft ? (
              <View style={styles.stack}>
                <View style={styles.heroWrap}>
                  {catalog?.image.constructedUrl ? (
                    <Image
                      accessibilityIgnoresInvertColors
                      accessibilityLabel={`${catalog.name} catalog art`}
                      contentFit="contain"
                      source={{ uri: catalog.image.constructedUrl }}
                      style={styles.hero}
                    />
                  ) : (
                    <View
                      accessibilityLabel={`${catalog?.name ?? "Card"} catalog art`}
                      style={[styles.hero, styles.heroFallback]}
                    />
                  )}
                </View>
                <Text style={styles.caption}>Catalog art — not a listing photo</Text>

                <Text style={styles.label}>Title</Text>
                <View style={styles.chips}>
                  <Chip
                    label="Default"
                    selected={draft.titleTemplateId !== "en_raw_single_with_condition"}
                    onPress={() => void save({ titleTemplateId: "default_en_raw_single" })}
                  />
                  <Chip
                    label="Include condition"
                    selected={draft.titleTemplateId === "en_raw_single_with_condition"}
                    onPress={() =>
                      void save({ titleTemplateId: "en_raw_single_with_condition" })
                    }
                  />
                </View>
                <TextInput
                  accessibilityLabel="Listing title"
                  onChangeText={setTitle}
                  style={styles.input}
                  value={title}
                />

                <Text style={styles.label}>Condition</Text>
                <View style={styles.chips}>
                  {CONDITION_LABELS.map((label) => (
                    <Chip
                      key={label}
                      label={label}
                      selected={condition === label}
                      onPress={() => setCondition(label)}
                    />
                  ))}
                </View>

                <Text style={styles.label}>Asking price (USD)</Text>
                <TextInput
                  accessibilityLabel="Asking price"
                  keyboardType="decimal-pad"
                  onChangeText={setAskingPrice}
                  placeholder="Your estimate, not a market price"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={askingPrice}
                />
                {askingPrice.trim() && parseDollarsToCents(askingPrice) === null ? (
                  <Text style={styles.error}>{INVALID_DOLLAR_AMOUNT}</Text>
                ) : null}
                <View style={styles.guidance}>
                  <View style={styles.guidanceRow}>
                    <Text style={styles.guidanceLabel}>Spread vs all-in</Text>
                    <Text style={styles.guidanceValue}>
                      {liveSpread ? `$${liveSpread.spread}` : "—"}
                    </Text>
                  </View>
                  <Text style={styles.body}>
                    Spread / cost-to-ask — never labeled profit.
                  </Text>
                </View>

                <Text style={styles.label}>Description</Text>
                <TextInput
                  accessibilityLabel="Listing description"
                  multiline
                  onChangeText={setDescription}
                  style={[styles.input, styles.multiline]}
                  value={description}
                />

                <Text style={styles.label}>Keyword chips</Text>
                <View style={styles.chips}>
                  {keywordChips.map((chip) => (
                    <Chip
                      key={chip}
                      label={chip}
                      onPress={() =>
                        setDescription((current) => appendSnippet(current, chip))
                      }
                    />
                  ))}
                </View>

                <Text style={styles.label}>Disclosure (optional)</Text>
                {DISCLOSURE_ITEMS.map((item) => (
                  <View key={item.id} style={styles.disclosure}>
                    <Text style={styles.body}>{item.label}</Text>
                    <View style={styles.chips}>
                      {item.answers.map((answer) => (
                        <Chip
                          key={answer}
                          label={answer}
                          selected={disclosure[item.id] === answer}
                          onPress={() =>
                            setDisclosure((current) => ({ ...current, [item.id]: answer }))
                          }
                        />
                      ))}
                    </View>
                  </View>
                ))}
                <PrimaryButton
                  label="Add disclosure to description"
                  tone="muted"
                  onPress={() =>
                    setDescription((current) => appendSnippet(current, disclosureText))
                  }
                />

                <Text style={styles.label}>Channel note (in-app only)</Text>
                <TextInput
                  accessibilityLabel="Intended channel note"
                  onChangeText={setChannelNote}
                  placeholder="Maybe eBay later"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={channelNote}
                />

                <Text style={styles.label}>Private notes (never copied)</Text>
                <TextInput
                  accessibilityLabel="Private notes"
                  multiline
                  onChangeText={setNotes}
                  placeholder="Binder B2"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.multiline]}
                  value={notes}
                />

                {missing.length > 0 ? (
                  <View style={styles.missing}>
                    <Text style={styles.body}>Ready for review still needs:</Text>
                    <Text style={styles.body}>{missing.join(", ")}.</Text>
                  </View>
                ) : null}
                {readyNotice ? <Text style={styles.notice}>{readyNotice}</Text> : null}
                {copyNotice ? <Text style={styles.notice}>{copyNotice}</Text> : null}
                {copyDisclaimer ? <Text style={styles.body}>{copyDisclaimer}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}

                <PrimaryButton
                  label={isSaving ? "Saving…" : "Save draft"}
                  onPress={() => void save()}
                  disabled={isSaving}
                />
                <PrimaryButton
                  label="Ready for review"
                  tone="muted"
                  onPress={() => void onReady()}
                  disabled={isSaving || !canMarkReady}
                />
                <PrimaryButton
                  label={hasCopied ? "Copy again" : "Copy"}
                  tone="muted"
                  onPress={() => void onCopy()}
                  disabled={isSaving}
                />
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    paddingHorizontal: space.md,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  blocked: {
    padding: space.lg,
    gap: space.md,
  },
  content: { paddingHorizontal: space.lg, paddingBottom: 48 },
  stack: { gap: space.md },
  heroWrap: { alignItems: "center" },
  hero: {
    width: 188,
    aspectRatio: 0.715,
    borderRadius: 16,
    backgroundColor: colors.chip,
  },
  heroFallback: { borderWidth: 1, borderColor: colors.cardBorder },
  caption: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.text, fontWeight: "700" },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  chip: {
    backgroundColor: colors.chip,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: "#2A2618" },
  chipLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  chipLabelSelected: { color: colors.accent },
  guidance: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.md,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  guidanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: space.md,
  },
  guidanceLabel: { color: colors.text, fontSize: 16, fontWeight: "800" },
  guidanceValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  disclosure: { gap: 8 },
  missing: { gap: 4 },
  notice: { color: colors.success, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger },
});
