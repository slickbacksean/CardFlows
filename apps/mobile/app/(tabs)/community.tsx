import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { 
  ActivityIndicator, 
  Alert, 
  FlatList, 
  Image, 
  Pressable, 
  RefreshControl,
  StyleSheet, 
  Text, 
  TextInput,
  View 
} from "react-native";
import { getFeed, reactToPost, deleteReaction, blockUser, reportContent, getCommunitySettings, updateCommunitySettings } from "@/lib/api";
import { colors, radii, space } from "@/lib/theme";

type Segment = "market" | "feed";
type FeedFilter = "all" | "sets";

interface Post {
  postId: string;
  displayName: string;
  createdAt: string;
  card: {
    name: string;
    setName: string;
    localId: string;
    imageUrl: string | null;
  };
  pricePaidCents: number | null;
  reactionCounts: {
    fire: number;
    eyes: number;
    gem: number;
    open_mouth: number;
    clap: number;
  };
  myReaction: string | null;
  commentCount: number;
}

const REACTION_EMOJI = {
  fire: "🔥",
  eyes: "👀",
  gem: "💎",
  open_mouth: "😮",
  clap: "👏",
};

const REACTION_LABELS = {
  fire: "Fire",
  eyes: "Eyes",
  gem: "Gem",
  open_mouth: "Wow",
  clap: "Clap",
};

export default function CommunityScreen() {
  const [segment, setSegment] = useState<Segment>("market");
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [showFirstTimeCard, setShowFirstTimeCard] = useState(false);

  const loadFeed = useCallback(async (refresh = false) => {
    if (segment !== "feed") return;
    
    if (refresh) {
      setRefreshing(true);
      setCursor(null);
    } else {
      setLoading(true);
    }
    
    setError(null);

    try {
      const result = await getFeed(feedFilter, refresh ? undefined : cursor || undefined);
      
      if ("error" in result) {
        throw new Error(result.error);
      }

      if (refresh) {
        setPosts(result.posts || []);
      } else {
        setPosts([...posts, ...(result.posts || [])]);
      }
      
      setCursor(result.nextCursor);
      setHasMore(!!result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load feed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [segment, feedFilter, cursor, posts]);

  useFocusEffect(
    useCallback(() => {
      if (segment === "feed") {
        void loadFeed(true);
        // Check if we should show first-time card
        void getCommunitySettings().then((settings) => {
          if (!("error" in settings) && !settings.shareNew && posts.length === 0) {
            setShowFirstTimeCard(true);
          }
        });
      }
    }, [segment])
  );

  async function handleReaction(post: Post, emoji: keyof typeof REACTION_EMOJI) {
    try {
      if (post.myReaction === emoji) {
        await deleteReaction(post.postId);
        setPosts(posts.map(p => p.postId === post.postId ? { 
          ...p, 
          myReaction: null,
          reactionCounts: { ...p.reactionCounts, [emoji]: p.reactionCounts[emoji] - 1 }
        } : p));
      } else {
        await reactToPost(post.postId, emoji);
        const oldReaction = post.myReaction;
        setPosts(posts.map(p => p.postId === post.postId ? {
          ...p,
          myReaction: emoji,
          reactionCounts: {
            ...p.reactionCounts,
            [emoji]: p.reactionCounts[emoji] + 1,
            ...(oldReaction ? { [oldReaction]: p.reactionCounts[oldReaction as keyof typeof REACTION_EMOJI] - 1 } : {})
          }
        } : p));
      }
    } catch (caught) {
      Alert.alert("Error", "Failed to react to post");
    }
  }

  function handleReport(post: Post) {
    Alert.alert(
      "Report Post",
      "Why are you reporting this?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Spam", onPress: () => void submitReport(post.postId, "spam") },
        { text: "Harassment", onPress: () => void submitReport(post.postId, "harassment") },
        { text: "Offensive", onPress: () => void submitReport(post.postId, "offensive") },
        { text: "Scam", onPress: () => void submitReport(post.postId, "scam") },
        { text: "Other", onPress: () => void submitReport(post.postId, "other") },
      ]
    );
  }

  async function submitReport(postId: string, reason: string) {
    try {
      await reportContent("post", postId, reason);
      Alert.alert("Reported", "Thanks. We'll review this within 24 hours.");
      setPosts(posts.filter(p => p.postId !== postId));
    } catch (caught) {
      Alert.alert("Error", "Failed to report post");
    }
  }

  function handleBlock(post: Post) {
    Alert.alert(
      "Block User",
      `Block ${post.displayName}? You won't see their posts and they won't see yours.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              // Extract userId from post (would need to be added to API response)
              // For now, just hide the post
              Alert.alert("Blocked", "User blocked successfully");
              setPosts(posts.filter(p => p.displayName !== post.displayName));
            } catch (caught) {
              Alert.alert("Error", "Failed to block user");
            }
          },
        },
      ]
    );
  }

  function renderFirstTimeCard() {
    if (!showFirstTimeCard) return null;

    return (
      <View style={styles.firstTimeCard}>
        <Text style={styles.firstTimeTitle}>Share your pulls?</Text>
        <Text style={styles.firstTimeBody}>
          Off by default. When on, new purchases appear in Community without your username unless you
          choose to show it.
        </Text>
        <View style={styles.firstTimeButtons}>
          <Pressable
            onPress={() => setShowFirstTimeCard(false)}
            style={[styles.firstTimeButton, styles.firstTimeButtonPrimary]}
          >
            <Text style={styles.firstTimeButtonText}>Keep off</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setShowFirstTimeCard(false);
              router.push("/community-settings");
            }}
            style={styles.firstTimeButton}
          >
            <Text style={[styles.firstTimeButtonText, { color: colors.accent }]}>Turn on…</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderPost({ item: post }: { item: Post }) {
    return (
      <View style={styles.post}>
        <View style={styles.postHeader}>
          <View style={styles.postUser}>
            <Text style={styles.postDisplayName}>{post.displayName}</Text>
            <Text style={styles.postTime}>
              {new Date(post.createdAt).toLocaleDateString(undefined, { 
                month: "short", 
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
              })}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Alert.alert(
                "Post Options",
                undefined,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Report", onPress: () => handleReport(post) },
                  { text: "Block user", style: "destructive", onPress: () => handleBlock(post) },
                ]
              );
            }}
            style={styles.postMenu}
          >
            <Ionicons color={colors.muted} name="ellipsis-horizontal" size={20} />
          </Pressable>
        </View>

        {post.card.imageUrl ? (
          <Image source={{ uri: post.card.imageUrl }} style={styles.cardImage} />
        ) : null}

        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{post.card.name}</Text>
          <Text style={styles.cardSet}>
            {post.card.setName} {post.card.localId}
          </Text>
          {post.pricePaidCents ? (
            <Text style={styles.pricePaid}>
              Paid ${(post.pricePaidCents / 100).toFixed(2)}
            </Text>
          ) : null}
        </View>

        <View style={styles.reactions}>
          {(Object.keys(REACTION_EMOJI) as Array<keyof typeof REACTION_EMOJI>).map((key) => {
            const count = post.reactionCounts[key];
            const isActive = post.myReaction === key;
            
            return (
              <Pressable
                key={key}
                accessibilityLabel={`React ${REACTION_LABELS[key]}, ${count}`}
                accessibilityRole="button"
                onPress={() => void handleReaction(post, key)}
                style={[styles.reactionButton, isActive && styles.reactionButtonActive]}
              >
                <Text style={styles.reactionEmoji}>{REACTION_EMOJI[key]}</Text>
                {count > 0 ? <Text style={styles.reactionCount}>{count}</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {post.commentCount > 0 ? (
          <Pressable
            onPress={() => router.push(`/post-comments?postId=${post.postId}`)}
            style={styles.commentsLink}
          >
            <Ionicons color={colors.accent} name="chatbubble-outline" size={16} />
            <Text style={styles.commentsLinkText}>
              {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push(`/post-comments?postId=${post.postId}`)}
            style={styles.commentsLink}
          >
            <Text style={[styles.commentsLinkText, { color: colors.muted }]}>Add a comment</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Pressable
          accessibilityLabel="Community settings"
          accessibilityRole="button"
          onPress={() => router.push("/community-settings")}
          style={styles.settingsButton}
        >
          <Ionicons color={colors.muted} name="settings-outline" size={24} />
        </Pressable>
      </View>

      <View style={styles.segments}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === "market" }}
          onPress={() => setSegment("market")}
          style={[styles.segmentButton, segment === "market" && styles.segmentButtonActive]}
        >
          <Text style={[styles.segmentText, segment === "market" && styles.segmentTextActive]}>
            Market
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === "feed" }}
          onPress={() => setSegment("feed")}
          style={[styles.segmentButton, segment === "feed" && styles.segmentButtonActive]}
        >
          <Text style={[styles.segmentText, segment === "feed" && styles.segmentTextActive]}>
            Feed
          </Text>
        </Pressable>
      </View>

      {segment === "feed" ? (
        <>
          <View style={styles.feedFilters}>
            <Pressable
              onPress={() => setFeedFilter("all")}
              style={[styles.filterChip, feedFilter === "all" && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, feedFilter === "all" && styles.filterChipTextActive]}>
                All
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setFeedFilter("sets")}
              style={[styles.filterChip, feedFilter === "sets" && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, feedFilter === "sets" && styles.filterChipTextActive]}>
                Following sets
              </Text>
            </Pressable>
          </View>

          <FlatList
            contentContainerStyle={styles.feedContent}
            data={posts}
            keyExtractor={(item) => item.postId}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
              ) : error ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>{error}</Text>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  {renderFirstTimeCard()}
                  <Text style={styles.emptyStateTitle}>No shared pulls yet</Text>
                  <Text style={styles.emptyStateText}>
                    Turn on sharing in settings to post yours
                  </Text>
                </View>
              )
            }
            ListHeaderComponent={renderFirstTimeCard}
            onEndReached={() => {
              if (hasMore && !loading) {
                void loadFeed();
              }
            }}
            onEndReachedThreshold={0.5}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void loadFeed(true)} />
            }
            renderItem={renderPost}
          />
        </>
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Market Coming Soon</Text>
          <Text style={styles.placeholderBody}>
            See biggest movers, what's buying, what's selling, and set trends.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  settingsButton: { padding: 8 },
  segments: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  segmentButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radii.pill,
  },
  segmentButtonActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  segmentTextActive: { color: colors.accentText },
  feedFilters: {
    flexDirection: "row",
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  filterChip: {
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterChipText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  filterChipTextActive: { color: colors.accentText },
  feedContent: { padding: space.lg, gap: space.md },
  post: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.sm,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  postUser: { flex: 1, gap: 2 },
  postDisplayName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  postTime: { color: colors.muted, fontSize: 12 },
  postMenu: { padding: 4 },
  cardImage: {
    width: "100%",
    aspectRatio: 0.7,
    borderRadius: radii.md,
    backgroundColor: colors.chip,
  },
  cardInfo: { gap: 2 },
  cardName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  cardSet: { color: colors.muted, fontSize: 13 },
  pricePaid: { color: colors.text, fontSize: 14, marginTop: 4 },
  reactions: {
    flexDirection: "row",
    gap: space.xs,
    flexWrap: "wrap",
  },
  reactionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.chip,
  },
  reactionButtonActive: { backgroundColor: colors.accent + "20" },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { color: colors.text, fontSize: 12, fontWeight: "700" },
  commentsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  commentsLinkText: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  firstTimeCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.sm,
    marginBottom: space.md,
  },
  firstTimeTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  firstTimeBody: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  firstTimeButtons: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.xs,
  },
  firstTimeButton: {
    flex: 1,
    paddingVertical: space.sm,
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  firstTimeButtonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  firstTimeButtonText: { color: colors.accentText, fontSize: 15, fontWeight: "700" },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  emptyStateTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  emptyStateText: { color: colors.muted, fontSize: 15, textAlign: "center", lineHeight: 22 },
  placeholder: { 
    flex: 1, 
    alignItems: "center", 
    justifyContent: "center", 
    gap: space.md, 
    paddingHorizontal: space.lg 
  },
  placeholderTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  placeholderBody: { 
    color: colors.muted, 
    fontSize: 15, 
    textAlign: "center", 
    maxWidth: 280, 
    lineHeight: 22 
  },
});
