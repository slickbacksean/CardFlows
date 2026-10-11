// Capgo InAppBrowser is a Capacitor plugin: it needs a Capacitor app shell, which this
// React Native app does not have. Keep its JS (lib/in-app-browser.ts reports it unavailable
// and the livestream tab falls back to react-native-webview) but skip native linking.
module.exports = {
  dependencies: {
    "@capgo/capacitor-inappbrowser": {
      platforms: { ios: null, android: null },
    },
  },
};
