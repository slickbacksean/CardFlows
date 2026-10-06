const { getDefaultConfig } = require("expo/metro-config");
const http = require("node:http");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

const API_PORT = 3001;

function isApiPath(url) {
  const pathOnly = (url ?? "").split("?")[0];
  return pathOnly === "/health" || pathOnly === "/v1" || pathOnly.startsWith("/v1/");
}

function proxyToApi(req, res) {
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (res.headersSent) return;
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "CardFlow API is not running" }));
  });
  req.pipe(proxyReq);
}

// The phone can reach Metro on 8081. A second Node listener on 3001 is blocked
// by the Mac firewall, so dev API calls from the phone come through here.
config.server.enhanceMiddleware = (metroMiddleware) => {
  return (req, res, next) => {
    if (isApiPath(req.url)) {
      proxyToApi(req, res);
      return;
    }
    return metroMiddleware(req, res, next);
  };
};

module.exports = config;
