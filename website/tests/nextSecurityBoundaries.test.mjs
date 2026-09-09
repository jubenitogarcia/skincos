import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { imageOptimizer, isAvifDecodeSafe } = require("next/dist/server/image-optimizer.js");
const { defaultConfig } = require("next/dist/server/config-shared.js");
const { getImageProps } = require("next/image.js");
const { getBlurImage } = require("next/dist/build/webpack/loaders/next-image-loader/blur.js");
const { decodePathParams } = require("next/dist/server/lib/router-utils/decode-path-params.js");
const { default: escapePathDelimiters } = require("next/dist/shared/lib/router/utils/escape-path-delimiters.js");

// Benign, generated inputs only. Create them before Next initializes its
// process-wide Sharp decoder restrictions. No uploaded media or exploit payloads.
const solidImage = { create: { width: 8, height: 8, channels: 3, background: "#49865a" } };
const avif = await sharp(solidImage).avif().toBuffer();
const ordinaryImages = await Promise.all(
  ["png", "jpeg", "webp"].map(async (format) => ({
    format,
    buffer: await sharp(solidImage)[format]().toBuffer(),
  })),
);
const blurOptions = {
  outputPath: "/images/synthetic.avif",
  isDev: false,
  tracing: () => ({ traceFn: (callback) => callback(), traceAsyncFn: (callback) => callback() }),
};

test("the installed Sharp decoder includes the patched libheif release", () => {
  const version = sharp.versions.heif;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(major > 1 || (major === 1 && (minor > 23 || (minor === 23 && patch >= 2))), version);
});

test("the decoder gate rejects old or unknown libheif versions", () => {
  for (const version of [null, "unknown", "1.23", "1.20.2", "1.23.0", "1.23.1"]) {
    assert.equal(isAvifDecodeSafe(version), false, String(version));
  }
  for (const version of ["1.23.2", "1.23.3", "1.24.0", "2.0.0"]) {
    assert.equal(isAvifDecodeSafe(version), true, version);
  }
});

test("AVIF still resizes with the patched installed decoder, including JPEG fallback", async () => {
  for (const mimeType of ["image/webp", "image/jpeg", ""]) {
    const result = await imageOptimizer(
      { buffer: avif, etag: "synthetic-avif", contentType: "image/png", cacheControl: "max-age=60" },
      { href: "/images/synthetic.png", width: 4, quality: 75, mimeType },
      defaultConfig,
      { isDev: false, silent: true },
    );
    assert.equal(result.contentType, mimeType || "image/jpeg");
    assert.equal((await sharp(result.buffer).metadata()).width, 4);
    assert.equal(result.upstreamEtag, "synthetic-avif");
  }
});

test("old or unknown decoder metadata bypasses AVIF and blocks direct optimizer callers", async () => {
  // Change only reported version metadata around the patched native library;
  // never install or exercise a vulnerable decoder. Next's actual block/unblock
  // operations enforce the restriction for the real benign AVIF buffer.
  try {
    for (const heif of [null, "1.23.0", "1.23.1"]) {
      const reportedSharp = Object.assign((...args) => sharp(...args), sharp, {
        versions: { ...sharp.versions, heif },
      });
      const optimizer = loadInstalledCommonJs("next/dist/server/image-optimizer.js", { sharp: reportedSharp });
      assert.equal(optimizer.canDecodeAvif(null), false);
      for (const mimeType of ["image/webp", "image/jpeg", "image/avif", ""]) {
        const result = await optimizer.imageOptimizer(
          { buffer: avif, etag: "synthetic-avif", contentType: "image/png", cacheControl: "max-age=60" },
          { href: "/images/synthetic.png", width: 4, quality: 75, mimeType },
          defaultConfig,
          { isDev: false, silent: true },
        );
        assert.equal(result.contentType, "image/avif");
        assert.deepEqual(result.buffer, avif);
        assert.equal(result.etag, "synthetic-avif");
        assert.equal(result.upstreamEtag, "synthetic-avif");
      }
      for (const contentType of ["image/webp", "image/png", "image/jpeg"]) {
        await assert.rejects(
          optimizer.optimizeImage({ buffer: avif, contentType, width: 4, quality: 75 }),
          /unsupported image format|operation is blocked/i,
        );
      }
      const control = await optimizer.optimizeImage({ buffer: ordinaryImages[0].buffer, contentType: "image/webp", width: 4, quality: 75 });
      assert.equal((await sharp(control).metadata()).width, 4);
      const blur = loadInstalledCommonJs("next/dist/build/webpack/loaders/next-image-loader/blur.js", {
        "../../../../server/image-optimizer": optimizer,
      });
      const placeholder = await blur.getBlurImage(avif, "avif", { width: 8, height: 8 }, blurOptions);
      assert.equal(placeholder.dataURL, undefined);
      assert.equal(placeholder.width, 0);
      assert.equal(placeholder.height, 0);
    }
  } finally {
    // Test files run in separate processes; restore this file's safe decoder
    // after the sequential negative cases for the remaining legitimate controls.
    sharp.unblock({ operation: ["VipsForeignLoadHeif"] });
  }
});

test("ordinary PNG, JPEG and WebP inputs still optimize and resize", async () => {
  for (const { format, buffer } of ordinaryImages) {
    const result = await imageOptimizer(
      { buffer, etag: `synthetic-${format}`, contentType: `image/${format}`, cacheControl: "max-age=60" },
      { href: `/images/synthetic.${format}`, width: 4, quality: 75, mimeType: "image/webp" },
      defaultConfig,
      { isDev: false, silent: true },
    );
    assert.equal(result.contentType, "image/webp");
    const metadata = await sharp(result.buffer).metadata();
    assert.equal(metadata.width, 4, format);
    assert.equal(metadata.height, 4, format);
  }
});

test("static AVIF blur generation works with the patched installed decoder", async () => {
  const placeholder = await getBlurImage(avif, "avif", { width: 8, height: 8 }, blurOptions);
  assert.match(placeholder.dataURL, /^data:image\/avif;base64,/);
  assert.equal(placeholder.width, 8);
  assert.equal(placeholder.height, 8);
});

test("static AVIF without automatic blur remains usable and an explicit blur remains intact", () => {
  const source = { src: "/images/synthetic.avif", width: 80, height: 80 };
  const { props } = getImageProps({ src: source, alt: "Synthetic", placeholder: "blur" });
  assert.equal(props.width, 80);
  assert.equal(props.height, 80);
  assert.equal(props.style.backgroundImage, undefined);

  const blurDataURL = `data:image/png;base64,${ordinaryImages[0].buffer.toString("base64")}`;
  const { props: custom } = getImageProps({ src: source, alt: "Synthetic", placeholder: "blur", blurDataURL });
  assert.match(custom.style.backgroundImage, /data:image\/svg\+xml/);
});

test("cache-busted logo URLs still produce normal optimized image props", () => {
  const { props } = getImageProps({ src: "/logo.png?v=20260120a", alt: "Espaço Facial", width: 700, height: 124 });
  const imageUrl = new URL(props.src, "https://synthetic.invalid");
  assert.equal(imageUrl.pathname, "/_next/image");
  assert.equal(imageUrl.searchParams.get("url"), "/logo.png?v=20260120a");
  assert.equal(props.width, 700);
  assert.equal(props.height, 124);
});

// Execute the installed implementation unchanged; substitute only its platform
// path dependency. This exercises Windows path semantics on Linux without a
// Windows server, filesystem writes, or a copy of the cache-containment logic.
function loadInstalledCommonJs(specifier, replacements) {
  const filename = require.resolve(specifier);
  const localRequire = createRequire(filename);
  const loadedModule = { exports: {} };
  runInNewContext(readFileSync(filename, "utf8"), {
    module: loadedModule,
    exports: loadedModule.exports,
    process,
    Buffer,
    console,
    require: (specifier) => Object.hasOwn(replacements, specifier)
      ? replacements[specifier]
      : localRequire(specifier),
  }, { filename });
  return loadedModule.exports;
}

for (const [platform, platformPath, serverDistDir] of [
  ["posix", path.posix, "/synthetic/.next/server"],
  ["win32", path.win32, "C:\\synthetic\\.next\\server"],
]) {
  test(`cache paths remain inside their own root under ${platform} semantics`, () => {
    const cache = loadInstalledCommonJs("next/dist/server/lib/incremental-cache/file-system-cache.js", {
      "../../../shared/lib/isomorphic/path": platformPath,
    });
    const getFilePath = cache.default.prototype.getFilePath.bind({ serverDistDir });
    for (const kind of ["PAGES", "APP_PAGE", "APP_ROUTE", "IMAGE", "FETCH"]) {
      const root = kind === "FETCH"
        ? platformPath.join(serverDistDir, "..", "cache", "fetch-cache")
        : platformPath.join(serverDistDir, kind === "PAGES" ? "pages" : "app");
      for (const key of ["index.html", "unidades/ação.html", "nested/item.json"]) {
        assert.equal(getFilePath(key, kind), platformPath.join(root, key));
      }
      const unsafeKeys = ["../outside/probe.html", "nested/../../outside/probe.html", `../${platformPath.basename(root)}-escape/probe.html`];
      if (platform === "win32") unsafeKeys.push("..\\outside\\probe.html", "nested\\..\\..\\outside\\probe.html", "nested/..\\..\\outside/probe.html");
      for (const key of unsafeKeys) {
        assert.throws(() => getFilePath(key, kind), /Invalid file path/, `${kind}: ${key}`);
      }
    }
    assert.throws(() => getFilePath("index.html", "UNKNOWN"), /Unexpected file path kind/);
  });
}

test("route decoding preserves encoded separators instead of turning them into cache path delimiters", () => {
  for (const [input, expected] of [
    ["..\\outside", "..%5Coutside"],
    ["..%5coutside", "..%255coutside"],
    ["..%5Coutside", "..%255Coutside"],
    ["a/b#c?d", "a%2Fb%23c%3Fd"],
    ["ação", "ação"],
  ]) {
    assert.equal(escapePathDelimiters(input, true), expected);
  }
  for (const [input, expected] of [
    ["/route/..%5coutside", "/route/..%5Coutside"],
    ["/route/..%5Coutside", "/route/..%5Coutside"],
    ["/route/..%255coutside", "/route/..%255coutside"],
    ["/route/a%2fb", "/route/a%2Fb"],
    ["/route/a%C3%A7%C3%A3o", "/route/ação"],
  ]) {
    assert.equal(decodePathParams(input), expected);
  }
  assert.throws(() => decodePathParams("/route/%ZZ"));
});
