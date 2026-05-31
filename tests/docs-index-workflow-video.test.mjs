import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

const rootDir = process.cwd();
const docsIndexPath = path.join(rootDir, "docs", "index.html");
const docsStylePath = path.join(rootDir, "docs", "style.css");
const workflowVideoAssetPath = path.join(rootDir, "docs", "assets", "workflow-command-video.mp4");
const docsServerScriptPath = path.join(rootDir, "scripts", "serve-static-docs.mjs");

function readUtf8(filePath) {
  return readFileSync(filePath, "utf8");
}

function getWorkflowVideoSection(html) {
  const match = html.match(
    /<section[^>]*id="workflow-video"[\s\S]*?<\/section>/i,
  );
  return match ? match[0] : "";
}

function httpGet(baseUrl, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL(requestPath, baseUrl), (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on("error", reject);
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate free port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startStaticDocsServer() {
  const port = await getFreePort();
  const child = spawn(process.execPath, [docsServerScriptPath], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const readiness = Promise.race([
    once(child.stdout, "data"),
    once(child.stderr, "data").then(([chunk]) => {
      throw new Error(`Static server startup failed: ${String(chunk)}`);
    }),
    once(child, "exit").then(([code]) => {
      throw new Error(`Static server exited before startup (code ${code ?? "null"}).`);
    }),
  ]);

  await readiness;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (!child.killed) {
        child.kill();
      }
      await once(child, "exit");
    },
  };
}

test("docs index includes workflow video contract", () => {
  const html = readUtf8(docsIndexPath);
  const workflowSection = getWorkflowVideoSection(html);

  assert.match(
    html,
    /id="workflow-video"/i,
    "Expected #workflow-video section near Quick Start.",
  );
  assert.ok(workflowSection.length > 0, "Expected workflow-video section body.");
  assert.match(
    workflowSection,
    /id="workflow-video-title"/i,
    "Expected heading id for accessible labeling.",
  );
  assert.match(
    workflowSection,
    /workflow-video__transcript/i,
    "Expected transcript or text alternative block.",
  );
  assert.match(
    workflowSection,
    /<video[^>]*aria-label="[^"]*ROACH PI command workflow[^"]*"[^>]*>/i,
    "Expected a native video element with an accessible workflow label.",
  );
  assert.match(
    workflowSection,
    /<source[^>]*src="assets\/workflow-command-video\.mp4"[^>]*type="video\/mp4"[^>]*>/i,
    "Expected MP4 source pointing at docs/assets/workflow-command-video.mp4 via relative src=\"assets/workflow-command-video.mp4\".",
  );

  for (const command of ["/setup", "/clarify", "/goal", "/goal subgoal", "/loop"]) {
    assert.match(
      workflowSection,
      new RegExp(command.replace("/", "\\/"), "i"),
      `Expected workflow frame command ${command}.`,
    );
  }

  const frameCount = (workflowSection.match(/workflow-video__frame/g) || []).length;
  assert.ok(frameCount >= 5, "Expected at least five workflow frames.");
});

test("workflow MP4 asset exists and has non-trivial size", () => {
  assert.ok(existsSync(workflowVideoAssetPath), "Expected workflow MP4 asset to exist.");
  const sizeBytes = statSync(workflowVideoAssetPath).size;
  assert.ok(sizeBytes > 10 * 1024, `Expected workflow MP4 asset > 10KB, received ${sizeBytes} bytes.`);
});

test("forbidden BETRO/BYER branding text is absent", () => {
  const html = readUtf8(docsIndexPath);
  const css = readUtf8(docsStylePath);
  const forbidden = /\bBETRO BYER\b|\bBETRO\b|\bBYER\b/i;
  assert.ok(!forbidden.test(html), "Forbidden branding found in docs/index.html.");
  assert.ok(!forbidden.test(css), "Forbidden branding found in docs/style.css.");
});

test("hero ASCII banner is readable ROACH PI text", () => {
  const html = readUtf8(docsIndexPath);
  const match = html.match(/<pre[^>]*class="hero-ascii"[^>]*>([\s\S]*?)<\/pre>/i);
  assert.ok(match, "Expected <pre class=\"hero-ascii\"> block.");

  const heroAscii = (match?.[1] ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r/g, "")
    .trim();

  assert.match(
    heroAscii,
    /ROACH\s+PI/i,
    "Expected hero ASCII banner text to include readable ROACH PI.",
  );
  assert.doesNotMatch(
    heroAscii,
    /[^\x09\x0A\x0D\x20-\x7E]/,
    "Expected hero ASCII banner to avoid non-ASCII block-art corruption.",
  );
});

test("workflow video CSS hooks and reduced-motion fallback exist", () => {
  const css = readUtf8(docsStylePath);
  const viewportBlockMatch = css.match(/\.workflow-video__viewport\s*\{([\s\S]*?)\}/i);
  const mediaBlockMatch = css.match(/\.workflow-video__media\s*\{([\s\S]*?)\}/i);

  for (const selector of [
    ".workflow-video",
    ".workflow-video__viewport",
    ".workflow-video__media",
    ".workflow-video__frame",
    ".workflow-video__timeline",
  ]) {
    assert.match(css, new RegExp(`\\${selector}\\b`), `Missing selector ${selector}.`);
  }

  assert.ok(viewportBlockMatch, "Missing .workflow-video__viewport CSS block.");
  const viewportBlock = viewportBlockMatch ? viewportBlockMatch[1] : "";
  assert.doesNotMatch(
    viewportBlock,
    /aspect-ratio\s*:/i,
    "Viewport must not force a fixed aspect ratio; media should own the ratio.",
  );
  assert.match(
    viewportBlock,
    /display\s*:\s*grid/i,
    "Viewport should use grid layout to isolate media and frame/timeline lanes.",
  );
  assert.match(
    viewportBlock,
    /grid-template-columns\s*:/i,
    "Viewport grid should define explicit columns for media and supporting content.",
  );

  assert.ok(mediaBlockMatch, "Missing .workflow-video__media CSS block.");
  const mediaBlock = mediaBlockMatch ? mediaBlockMatch[1] : "";
  assert.match(
    mediaBlock,
    /aspect-ratio\s*:\s*16\s*\/\s*9/i,
    "Workflow video media must preserve 16:9 aspect ratio.",
  );

  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/i,
    "Missing reduced-motion media query for workflow-video.",
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*768px\)[\s\S]*workflow-video/i,
    "Missing responsive workflow-video behavior at mobile breakpoint.",
  );
});

test("static docs server serves /docs/* and assets and blocks traversal", async () => {
  const server = await startStaticDocsServer();
  try {
    const docsIndex = await httpGet(server.baseUrl, "/docs/index.html#quickstart");
    assert.equal(docsIndex.statusCode, 200, "Expected /docs/index.html to return HTTP 200.");
    assert.match(
      docsIndex.body.toString("utf8"),
      /id="workflow-video"/i,
      "Expected /docs/index.html to include #workflow-video section.",
    );

    const docsVideoAsset = await httpGet(server.baseUrl, "/docs/assets/workflow-command-video.mp4");
    assert.equal(docsVideoAsset.statusCode, 200, "Expected /docs/assets MP4 to return HTTP 200.");
    assert.match(
      String(docsVideoAsset.headers["content-type"] ?? ""),
      /^video\/mp4/i,
      "Expected MP4 content-type.",
    );
    assert.ok(docsVideoAsset.body.length > 0, "Expected /docs/assets MP4 response body to include bytes.");

    const legacyVideoAsset = await httpGet(server.baseUrl, "/assets/workflow-command-video.mp4");
    assert.equal(legacyVideoAsset.statusCode, 200, "Expected legacy /assets MP4 alias to return HTTP 200.");
    assert.match(
      String(legacyVideoAsset.headers["content-type"] ?? ""),
      /^video\/mp4/i,
      "Expected legacy /assets MP4 content-type.",
    );
    assert.ok(legacyVideoAsset.body.length > 0, "Expected legacy /assets MP4 response body to include bytes.");

    const traversal = await httpGet(server.baseUrl, "/../package.json");
    assert.equal(traversal.statusCode, 404, "Expected path traversal request to return HTTP 404.");
  } finally {
    await server.stop();
  }
});
