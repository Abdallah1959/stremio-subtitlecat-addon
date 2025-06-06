const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const iso6391 = require("iso-639-1"); // لتحويل أسماء اللغات لرموز ISO

const manifest = require("./manifest.json");

const builder = new addonBuilder(manifest);

// كاش مؤقت في الذاكرة (يمكن تطويره لاستخدام Redis أو ملفات خارجية لو حبيت)
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

  try {
    const { data } = await axios.get(searchUrl, { timeout: 5000 });
    const $ = cheerio.load(data);
    const results = [];

    $("tr").each((i, el) => {
      const link = $(el).find("td a").attr("href");
      const langText = $(el).find("td:nth-child(2)").text().trim();
      const qualityText = $(el).find("td:nth-child(4)").text().trim();

      if (link && langText) {
        results.push({
          link: `https://subtitlecat.com${link}`,
          lang: langText,
          quality: qualityText,
        });
      }
    });

    cache.set(cacheKey, { timestamp: now, data: results });
    return results;
  } catch (error) {
    console.error("Error fetching subtitles:", error.message);
    return [];
  }
}

function filterSubtitlesByQuality(results, preferredQualities = ["HD", "SD"]) {
  return results.filter((r) =>
    preferredQualities.some((q) => r.quality.toUpperCase().includes(q))
  );
}

async function getDownloadLink(subtitlePageUrl) {
  try {
    const { data } = await axios.get(subtitlePageUrl, { timeout: 5000 });
    const $ = cheerio.load(data);

    // محاولة البحث عن زر التنزيل بعدة طرق تحسبًا لأي تغيرات في الموقع
    let downloadLink =
      $("a.btn-success").attr("href") ||
      $("a.download-button").attr("href") ||
      $("a[href*='download']").attr("href");

    if (downloadLink) {
      // لو الرابط نسبي نضيف النطاق الأساسي
      if (!downloadLink.startsWith("http")) {
        downloadLink = `https://subtitlecat.com${downloadLink}`;
      }
      return downloadLink;
    }
    return null;
  } catch (error) {
    console.error("Error fetching download link:", error.message);
    return null;
  }
}

// دالة لتحويل اسم اللغة إلى كود ISO
function getLanguageCode(name) {
  const lowerName = name.toLowerCase();

  if (lowerName.includes("arabic") || lowerName.includes("arab")) return "ar";
  if (lowerName.includes("english")) return "en";
  if (lowerName.includes("french")) return "fr";
  if (lowerName.includes("spanish")) return "es";

  // لو الاسم غير معروف، نجرب باستخدام مكتبة iso-639-1
  const code = iso6391.getCode(name);
  if (code) return code;

  return "en"; // قيمة افتراضية
}

builder.defineSubtitlesHandler(async ({ id, type, name, year }) => {
  if (!name) return { subtitles: [] };

  try {
    let results = await fetchSubtitleLinks({ id, name });

    // تحسين فلترة الجودة، ممكن تضيف أو تقلل حسب الطلب
    results = filterSubtitlesByQuality(results, ["HD", "SD", "CAM", "TS", "DVDRip"]);

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
  console.log("✅ Server listening on http://localhost:3000");
}
