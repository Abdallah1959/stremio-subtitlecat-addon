const { addonBuilder } = require("stremio-addon-sdk");
const puppeteer = require("puppeteer");

const manifest = {
  id: "org.subtitlecat.puppeteer",
  version: "1.0.0",
  name: "SubtitleCat Puppeteer Addon",
  description: "Fetch subtitles from SubtitleCat using Puppeteer",
  resources: ["subtitles"],
  types: ["movie", "series"],
  catalogs: [],
};

const builder = new addonBuilder(manifest);

// دالة لتحويل اسم اللغة إلى كود ISO (مبسطة)
function getLanguageCode(name) {
  const lang = name.toLowerCase();
  if (lang.includes("arabic") || lang.includes("arab")) return "ar";
  if (lang.includes("english")) return "en";
  if (lang.includes("french")) return "fr";
  if (lang.includes("spanish")) return "es";
  return "en";
}

// دالة لجلب الترجمات من subtitlecat.com باستخدام Puppeteer
async function fetchSubtitlesFromSubtitleCat(searchTerm) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  // رابط البحث
  const searchUrl = `https://subtitlecat.com/index.php?search=${encodeURIComponent(searchTerm)}`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  // ننتظر جدول النتائج يظهر
  await page.waitForSelector("table.table");

  // نجمع روابط الترجمات من النتائج
  const results = await page.$$eval("table.table tbody tr", rows => {
    return rows.map(row => {
      const linkElem = row.querySelector("td a");
      const langText = row.querySelector("td:nth-child(2)")?.textContent.trim() || "";
      const qualityText = row.querySelector("td:nth-child(4)")?.textContent.trim() || "";
      if (linkElem && langText) {
        return {
          pageLink: linkElem.href,
          lang: langText,
          quality: qualityText,
        };
      }
      return null;
    }).filter(x => x !== null);
  });

  // دالة للحصول على رابط تنزيل الترجمة من صفحة الترجمة
  async function getDownloadLink(subtitlePageUrl) {
    const newPage = await browser.newPage();
    await newPage.goto(subtitlePageUrl, { waitUntil: "domcontentloaded" });

    // ننتظر زر التحميل يظهر
    await newPage.waitForSelector("a.btn-success, a.download-button, a[href*='download']");

    const downloadLink = await newPage.$eval("a.btn-success, a.download-button, a[href*='download']", a => a.href);

    await newPage.close();
    return downloadLink;
  }

  // نجمع روابط التحميل النهائية
  const subtitles = [];
  for (const res of results) {
    try {
      const downloadUrl = await getDownloadLink(res.pageLink);
      subtitles.push({
        lang: getLanguageCode(res.lang),
        url: downloadUrl,
        title: `SubtitleCat - ${res.lang} [${res.quality}]`,
        id: res.pageLink,
      });
    } catch (err) {
      // لو حصل خطأ، نتجاهله ونكمل
      continue;
    }
  }

  await browser.close();
  return subtitles;
}

// تعريف معالج الترجمات مع طباعة الأخطاء والتفاصيل
builder.defineSubtitlesHandler(async ({ id, name }) => {
  console.log("Requested subtitles for:", name);
  if (!name) return { subtitles: [] };

  try {
    const subtitles = await fetchSubtitlesFromSubtitleCat(name);
    console.log("Found subtitles:", subtitles);
    return { subtitles };
  } catch (error) {
    console.error("Error fetching subtitles:", error);
    return { subtitles: [] };
  }
});

module.exports = builder.getInterface();

// لتشغيل الإضافة محلياً على المنفذ 7000
if (require.main === module) {
  const { serveHTTP } = require("stremio-addon-sdk");
  serveHTTP(builder.getInterface(), { port: 7000 });
  console.log("Addon running on http://localhost:7000");
}
