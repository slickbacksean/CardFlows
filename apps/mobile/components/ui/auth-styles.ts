import { StyleSheet } from "react-native";
import { colors, space } from "@/lib/theme";

/** Shared by sign-up, forgot password and reset password. */
export const authStyles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  body: { color: colors.muted, fontSize: 16, lineHeight: 22 },
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
  error: { color: colors.danger, fontSize: 14 },
  link: { color: colors.accent, fontSize: 15, fontWeight: "600" },
});
