import {
  CAMERA_PREPROMPT_CONTINUE,
  CHOOSE_PHOTO_LABEL,
  OPEN_SETTINGS_LABEL,
  SEARCH_BY_NAME_LABEL,
} from "@cardflow/shared";
import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/ui/primary-button";
import { colors, space } from "@/lib/theme";

interface PermissionGateProps {
  title: string;
  body: string;
  disabled?: boolean;
  continueLabel?: string;
  onContinue?: () => void;
  onOpenSettings?: () => void;
  choosePhotoLabel?: string;
  onChoosePhoto: () => void;
  onSearchByName?: () => void;
}

export function PermissionGate({
  title,
  body,
  disabled,
  continueLabel = CAMERA_PREPROMPT_CONTINUE,
  onContinue,
  onOpenSettings,
  choosePhotoLabel = CHOOSE_PHOTO_LABEL,
  onChoosePhoto,
  onSearchByName,
}: PermissionGateProps) {
  return (
    <View style={styles.panelBody}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onContinue ? (
        <PrimaryButton disabled={disabled} label={continueLabel} onPress={onContinue} />
      ) : null}
      {onOpenSettings ? (
        <PrimaryButton
          disabled={disabled}
          label={OPEN_SETTINGS_LABEL}
          onPress={onOpenSettings}
          tone="muted"
        />
      ) : null}
      <PrimaryButton
        disabled={disabled}
        label={choosePhotoLabel}
        onPress={onChoosePhoto}
        tone={onContinue ? "muted" : "cta"}
      />
      {onSearchByName ? (
        <PrimaryButton
          disabled={disabled}
          label={SEARCH_BY_NAME_LABEL}
          onPress={onSearchByName}
          tone="muted"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panelBody: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
