const { addonBuilder } = require("stremio-addon-sdk");
const puppeteer = require("puppeteer");
const iso6391 = require("iso-639-1");
const manifest = require("./manifest.json");

const builder = new addonBuilder(manifest);

// كاش مؤقت
const cache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 دقائق

async function fetchSubtitleLinks({ id, name }) {
  const cacheKey = `${id || name}`;
  const now = Date.now();

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (now - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }
  }

  let searchTerm = name;
  if (id && id.startsWith("tt")) {
    searchTerm = id;
  }
  const searchUrl = `https://subtitlecat.com/index.php?search=${encodeURIComponent(searchTerm)}`;

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

  const results = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const data = [];

    for (const row of rows) {
      const linkEl = row.querySelector("td a");
      const langEl = row.querySelector("td:nth-child(2)");
      const qualityEl = row.querySelector("td:nth-child(4)");

      if (linkEl && langEl && qualityEl) {
        data.push({
          link: "https://subtitlecat.com" + linkEl.getAttribute("href"),
          lang: langEl.textContent.trim(),
          quality: qualityEl.textContent.trim(),
        });
      }
    }

    return data;
  });

  await browser.close();

  cache.set(cacheKey, { timestamp: now, data: results });
  return results;
}

function filterSubtitlesByQuality(results, preferredQualities = ["HD", "SD", "DVDRip", "CAM"]) {
  return results.filter((r) =>
    preferredQualities.some((q) => r.quality.toUpperCase().includes(q.toUpperCase()))
  );
}

async function getDownloadLink(subtitlePageUrl) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(subtitlePageUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

  const downloadLink = await page.evaluate(() => {
    const btn = document.querySelector("a.btn-success, a.download-button, a[href*='download']");
    if (btn) {
      let href = btn.getAttribute("href");
      if (!href.startsWith("http")) {
        href = "https://subtitlecat.com" + href;
      }
      return href;
    }
    return null;
  });

  await browser.close();
  return downloadLink;
}

function getLanguageCode(name) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("arabic") || lowerName.includes("arab")) return "ar";
  if (lowerName.includes("english")) return "en";
  if (lowerName.includes("french")) return "fr";
  if (lowerName.includes("spanish")) return "es";

  const code = iso6391.getCode(name);
  return code || "en";
}

builder.defineSubtitlesHandler(async ({ id, type, name, year }) => {
  if (!name) return { subtitles: [] };

  try {
    let results = await fetchSubtitleLinks({ id, name });
    results = filterSubtitlesByQuality(results);

    const subtitles = [];
    for (const result of results) {
      const downloadUrl = await getDownloadLink(result.link);
      if (downloadUrl) {
        const langCode = getLanguageCode(result.lang);
        subtitles.push({
          id: result.link,
          lang: langCode,
          url: downloadUrl,
          title: `SubtitleCat - ${result.lang} [${result.quality}]`,
          year: year || undefined,
        });
      }
    }

    return { subtitles };
  } catch (error) {
    console.error("SubtitleCat Addon Error:", error.message);
    return { subtitles: [] };
  }
});

module.exports = builder.getInterface();

if (require.main === module) {
  const { serveHTTP } = require("stremio-addon-sdk");
  serveHTTP(builder.getInterface(), { port: 3000 });
  console.log("✅ Server running at http://localhost:3000");
}
