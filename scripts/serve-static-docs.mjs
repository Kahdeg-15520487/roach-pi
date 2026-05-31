#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const docsRoot = resolve(projectRoot, "docs");
const assetsRoot = resolve(projectRoot, "assets");

const mimeByExt = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

const port = Number.parseInt(process.env.PORT ?? "4173", 10);

function send404(response) {
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Not Found");
}

function resolveRequestPath(urlPath) {
  const [pathnameRaw] = urlPath.split("?");
  const pathname = (pathnameRaw || "/").replace(/\\/g, "/");

  if (pathname === "/") {
    return join(docsRoot, "index.html");
  }

  if (pathname.startsWith("/assets/")) {
    const assetRelativePath = pathname.slice("/assets/".length);
    const docsAssetPath = resolve(docsRoot, "assets", assetRelativePath);
    if (existsSync(docsAssetPath)) {
      return docsAssetPath;
    }
    return resolve(assetsRoot, assetRelativePath);
  }

  const docsRelativePath = pathname.replace(/^\/docs\/?/, "").replace(/^\/+/, "");
  return resolve(docsRoot, docsRelativePath);
}

function isInsideRoot(filePath, rootPath) {
  const rel = relative(rootPath, filePath);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(":");
}

function isAllowedPath(filePath) {
  return isInsideRoot(filePath, docsRoot) || isInsideRoot(filePath, assetsRoot);
}

createServer((request, response) => {
  const targetPath = resolveRequestPath(request.url || "/");

  if (!isAllowedPath(targetPath) || !existsSync(targetPath) || statSync(targetPath).isDirectory()) {
    send404(response);
    return;
  }

  const extension = extname(targetPath).toLowerCase();
  const contentType = mimeByExt.get(extension) ?? "application/octet-stream";

  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  createReadStream(targetPath).pipe(response);
}).listen(port, () => {
  process.stdout.write(`Static docs server ready at http://localhost:${port}\n`);
});
