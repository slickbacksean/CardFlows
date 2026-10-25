import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { 
  ActivityIndicator, 
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable, 
  StyleSheet, 
  Text, 
  TextInput,
  View 
} from "react-native";
import { useFocusEffect } from "expo-router";
import { getComments, postComment, deleteComment, reportContent, getCommunitySettings, updateCommunitySettings } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";
import Ionicons from "@expo/vector-icons/Ionicons";

interface Comment {
  commentId: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
  isOwn: boolean;
  removed: boolean;
  hidden: boolean;
}

const MAX_COMMENT_LENGTH = 280;

export default function PostCommentsScreen() {
  const params = useLocalSearchParams<{ postId: string }>();
  const postId = typeof params.postId === "string" ? params.postId : "";

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [showRulesPrompt, setShowRulesPrompt] = useState(false);

  const loadComments = useCallback(async () => {
    if (!postId) return;

    setLoading(true);
    setError(null);

    try {
      const [commentsResult, settings] = await Promise.all([
        getComments(postId),
        getCommunitySettings(),
      ]);

      if ("error" in commentsResult) {
        throw new Error(commentsResult.error);
      }

      setComments(commentsResult.comments || []);
      
      if (!("error" in settings)) {
        setRulesAccepted(settings.rulesAccepted || false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      void loadComments();
    }, [loadComments])
  );

  async function handlePostComment() {
    const trimmed = commentText.trim();
    if (!trimmed) return;

    if (trimmed.length > MAX_COMMENT_LENGTH) {
      Alert.alert("Too Long", `Comments must be ${MAX_COMMENT_LENGTH} characters or less`);
      return;
    }

    if (!rulesAccepted) {
      setShowRulesPrompt(true);
      return;
    }

    setPosting(true);
    setError(null);

    try {
      const result = await postComment(postId, trimmed);
      
      if ("error" in result) {
        throw new Error(result.error);
      }

      setCommentText("");
      await loadComments();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to post comment";
      if (message.includes("rate limit")) {
        Alert.alert("Slow Down", "You can post 10 comments per hour. Try again later.");
      } else {
        setError(message);
      }
    } finally {
      setPosting(false);
    }
  }

  async function acceptRules() {
    try {
      await updateCommunitySettings({ rulesAccepted: true });
      setRulesAccepted(true);
      setShowRulesPrompt(false);
      await handlePostComment();
    } catch (caught) {
      Alert.alert("Error", "Failed to accept rules");
    }
  }

  function handleReportComment(comment: Comment) {
    Alert.alert(
      "Report Comment",
      "Why are you reporting this?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Spam", onPress: () => void submitReport(comment.commentId, "spam") },
        { text: "Harassment", onPress: () => void submitReport(comment.commentId, "harassment") },
        { text: "Offensive", onPress: () => void submitReport(comment.commentId, "offensive") },
      ]
    );
  }

  async function submitReport(commentId: string, reason: string) {
    try {
      await reportContent("comment", commentId, reason);
      Alert.alert("Reported", "Thanks. We'll review this within 24 hours.");
      setComments(comments.filter(c => c.commentId !== commentId));
    } catch (caught) {
      Alert.alert("Error", "Failed to report comment");
    }
  }

  async function handleDeleteComment(commentId: string) {
    Alert.alert(
      "Delete Comment",
      "Are you sure you want to delete this comment?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteComment(commentId);
              setComments(comments.filter(c => c.commentId !== commentId));
            } catch (caught) {
              Alert.alert("Error", "Failed to delete comment");
            }
          },
        },
      ]
    );
  }

  function renderComment({ item: comment }: { item: Comment }) {
    if (comment.removed) {
      return (
        <View style={styles.comment}>
          <Text style={styles.commentRemoved}>Comment removed.</Text>
        </View>
      );
    }

    return (
      <View style={styles.comment}>
        <View style={styles.commentHeader}>
          <View style={styles.commentUser}>
            <Text style={styles.commentUsername}>{comment.username}</Text>
            <Text style={styles.commentTime}>
              {new Date(comment.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          {comment.isOwn || !comment.hidden ? (
            <Pressable
              onPress={() => {
                const options = comment.isOwn
                  ? [
                      { text: "Cancel", style: "cancel" as const },
                      { 
                        text: "Delete", 
                        style: "destructive" as const, 
                        onPress: () => handleDeleteComment(comment.commentId) 
                      },
                    ]
                  : [
                      { text: "Cancel", style: "cancel" as const },
                      { text: "Report", onPress: () => handleReportComment(comment) },
                    ];
                Alert.alert("Comment Options", undefined, options);
              }}
              style={styles.commentMenu}
            >
              <Ionicons color={colors.muted} name="ellipsis-horizontal" size={16} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.commentText}>{comment.text}</Text>
        {comment.hidden && comment.isOwn ? (
          <Text style={styles.commentUnderReview}>Under review</Text>
        ) : null}
      </View>
    );
  }

  if (showRulesPrompt) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Community Rules" }} />
        <View style={styles.rulesPrompt}>
          <Text style={styles.rulesTitle}>Accept Community Rules</Text>
          <Text style={styles.rulesBody}>
            Before commenting, please agree to follow our community rules:
          </Text>
          <Text style={styles.rulesList}>
            • Be respectful and kind{"\n"}
            • No harassment, hate speech, or bullying{"\n"}
            • No scams, fraud, or misleading posts{"\n"}
            • No spam or off-topic content{"\n"}
            • Follow all applicable laws
          </Text>
          <Pressable onPress={() => void acceptRules()} style={styles.acceptButton}>
            <Text style={styles.acceptButtonText}>I Accept</Text>
          </Pressable>
          <Pressable onPress={() => setShowRulesPrompt(false)} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <Stack.Screen options={{ title: "Comments" }} />
      
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={comments}
          keyExtractor={(item) => item.commentId}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
            </View>
          }
          renderItem={renderComment}
        />
      )}

      <View style={styles.composer}>
        <TextInput
          maxLength={MAX_COMMENT_LENGTH}
          multiline
          onChangeText={setCommentText}
          placeholder="Add a comment"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={commentText}
        />
        <Pressable
          disabled={!commentText.trim() || posting}
          onPress={() => void handlePostComment()}
          style={[styles.sendButton, (!commentText.trim() || posting) && styles.sendButtonDisabled]}
        >
          {posting ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <Ionicons color={colors.accentText} name="send" size={20} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  emptyText: { color: colors.muted, fontSize: 15, textAlign: "center" },
  errorText: { color: colors.danger, fontSize: 15, textAlign: "center" },
  list: { padding: space.lg, gap: space.sm },
  comment: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.xs,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  commentUser: { flex: 1, gap: 2 },
  commentUsername: { color: colors.text, fontSize: 14, fontWeight: "700" },
  commentTime: { color: colors.muted, fontSize: 11 },
  commentMenu: { padding: 4 },
  commentText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  commentRemoved: { color: colors.muted, fontSize: 14, fontStyle: "italic" },
  commentUnderReview: { color: colors.muted, fontSize: 12, fontStyle: "italic", marginTop: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.md,
    padding: space.sm,
    color: colors.text,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: { opacity: 0.5 },
  rulesPrompt: {
    flex: 1,
    padding: space.lg,
    justifyContent: "center",
    gap: space.md,
  },
  rulesTitle: { color: colors.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  rulesBody: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  rulesList: { color: colors.text, fontSize: 15, lineHeight: 24, marginVertical: space.md },
  acceptButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    padding: space.md,
    alignItems: "center",
  },
  acceptButtonText: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
  cancelButton: {
    padding: space.md,
    alignItems: "center",
  },
  cancelButtonText: { color: colors.muted, fontSize: 16 },
});
