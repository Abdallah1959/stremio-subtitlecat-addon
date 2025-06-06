const { addonBuilder } = require('stremio-addon-sdk');
const needle = require('needle');
const cheerio = require('cheerio');

const manifest = require('./manifest.json');
const builder = new addonBuilder(manifest);

async function fetchSubtitlesFromSubtitleCat(query) {
  const searchUrl = `https://subtitlecat.com/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await needle('get', searchUrl);
    const $ = cheerio.load(res.body);

    let subtitles = [];

    $('.subtitle-list .subtitle-item').each((i, el) => {
      const lang = $(el).find('.language').text().trim().toLowerCase();
      const link = $(el).find('a.download-link').attr('href');

      if (link) {
        subtitles.push({
          id: `subtitlecat-${i}`,
          lang: lang,
          url: `https://subtitlecat.com${link}`,
          name: `SubtitleCat - ${lang.toUpperCase()}`
        });
      }
    });

    return subtitles;
  } catch (error) {
    console.error('Error fetching subtitles:', error);
    return [];
  }
}

builder.defineSubtitlesHandler(async ({ name }) => {
  if (!name) return { subtitles: [] };
  const subtitles = await fetchSubtitlesFromSubtitleCat(name);
  return { subtitles };
});

module.exports = builder.getInterface();
