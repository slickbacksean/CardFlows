import { LIVE_HLS_REPORT_SCRIPT, liveHlsUrlFromWebMessage } from "@cardflow/shared";
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { noteLiveHlsUrl } from "@/lib/live-identify";
import {
  closeLivestreamBrowser,
  goBackLivestreamBrowser,
  goForwardLivestreamBrowser,
  hideLivestreamBrowser,
  isCapgoLivestreamBrowserAvailable,
  openLivestreamBrowser,
} from "@/lib/in-app-browser";
import { colors } from "@/lib/theme";

export interface LivestreamBrowserPageState {
  canGoBack: boolean;
  canGoForward: boolean;
  pageOn: boolean;
}

export interface LivestreamBrowserHandle {
  goBack: () => void;
  goForward: () => void;
}

export interface LivestreamBrowserProps {
  url: string;
  liveRegionLabel: string;
  visible: boolean;
  reloadKey: number;
  onLoadError: () => void;
  onPageStateChange?: (state: LivestreamBrowserPageState) => void;
}

export const LivestreamBrowser = forwardRef<LivestreamBrowserHandle, LivestreamBrowserProps>(
  function LivestreamBrowser(
    { url, liveRegionLabel, visible, reloadKey, onLoadError, onPageStateChange },
    ref,
  ) {
    const hostRef = useRef<View>(null);
    const webViewRef = useRef<WebView>(null);
    const frameRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
    const [layoutEpoch, setLayoutEpoch] = useState(0);
    const [useFallback, setUseFallback] = useState(
      () => Platform.OS === "web" || !isCapgoLivestreamBrowserAvailable(),
    );
    const [pageState, setPageState] = useState<LivestreamBrowserPageState>({
      canGoBack: false,
      canGoForward: false,
      pageOn: false,
    });

    if (!visible && (pageState.pageOn || pageState.canGoBack || pageState.canGoForward)) {
      setPageState({ canGoBack: false, canGoForward: false, pageOn: false });
    }

    useEffect(() => {
      onPageStateChange?.(pageState);
    }, [onPageStateChange, pageState]);

    useImperativeHandle(ref, () => ({
      goBack() {
        if (useFallback) {
          webViewRef.current?.goBack();
          return;
        }
        void goBackLivestreamBrowser();
      },
      goForward() {
        if (useFallback) {
          webViewRef.current?.goForward();
          return;
        }
        void goForwardLivestreamBrowser();
      },
    }));

    useEffect(() => {
      if (!visible) {
        void hideLivestreamBrowser();
        return;
      }
      if (useFallback) return undefined;
      const frame = frameRef.current;
      if (frame.width <= 0 || frame.height <= 0) return undefined;
      let cancelled = false;
      void openLivestreamBrowser({ url, frame }).then((kind) => {
        if (cancelled) return;
        if (kind === "unavailable") setUseFallback(true);
        else setPageState((current) => ({ ...current, pageOn: true }));
      });
      return () => {
        cancelled = true;
        void hideLivestreamBrowser();
      };
    }, [url, visible, reloadKey, useFallback, layoutEpoch]);

    useEffect(() => {
      return () => {
        void closeLivestreamBrowser();
      };
    }, []);

    function onWebMessage(event: WebViewMessageEvent) {
      const url = liveHlsUrlFromWebMessage(event.nativeEvent.data);
      if (url) noteLiveHlsUrl(url);
    }

    function onNavigationStateChange(nav: WebViewNavigation) {
      setPageState({
        canGoBack: nav.canGoBack,
        canGoForward: nav.canGoForward,
        pageOn: !nav.loading,
      });
    }

    if (!visible) {
      return <View accessibilityLabel={liveRegionLabel} style={styles.host} />;
    }

    if (useFallback) {
      return (
        <View accessibilityLabel={liveRegionLabel} style={styles.host}>
          <WebView
            allowsBackForwardNavigationGestures
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            applicationNameForUserAgent="Version/17.2 Mobile/15E148 Safari/604.1"
            injectedJavaScriptBeforeContentLoaded={LIVE_HLS_REPORT_SCRIPT}
            javaScriptEnabled
            key={`${url}-${reloadKey}`}
            mediaPlaybackRequiresUserAction={false}
            onMessage={onWebMessage}
            onError={onLoadError}
            onHttpError={onLoadError}
            onLoadEnd={() => {
              setPageState((current) => ({ ...current, pageOn: true }));
            }}
            onNavigationStateChange={onNavigationStateChange}
            originWhitelist={["*"]}
            ref={webViewRef}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={{ uri: url }}
            startInLoadingState
            style={styles.webView}
            userAgent={
              Platform.OS === "ios"
                ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
                : undefined
            }
          />
        </View>
      );
    }

    return (
      <View
        accessibilityLabel={liveRegionLabel}
        onLayout={() => {
          hostRef.current?.measureInWindow((x, y, width, height) => {
            const previous = frameRef.current;
            if (
              previous.x === x &&
              previous.y === y &&
              previous.width === width &&
              previous.height === height
            ) {
              return;
            }
            frameRef.current = { x, y, width, height };
            setLayoutEpoch((epoch) => epoch + 1);
          });
        }}
        ref={hostRef}
        style={styles.host}
      />
    );
  },
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: colors.chip,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.chip,
  },
});
