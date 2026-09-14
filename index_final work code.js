const express = require('express');
const { webkit } = require('playwright');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 7860;
const API_SECRET = "MY_SECRET_BOT_KEY_123";

let globalBrowser = null;

async function getBrowser() {
  if (!globalBrowser || !globalBrowser.isConnected()) {
    console.log('🌐 Launching WebKit Browser Engine...');
    globalBrowser = await webkit.launch({
      headless: true
    });
  }
  return globalBrowser;
}

app.post('/api/automate', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { targetUrl, action } = req.body;

  if (action === 'get_video_url') {
    console.log(`\n📩 [REQ RECEIVED] Processing: ${targetUrl}`);
    let context = null;
    let page = null;

    try {
      const browser = await getBrowser();
      
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
      });
      page = await context.newPage();

      let capturedVideoUrl = null;

      // RAM සුරැකීමට Images, CSS, Fonts Block කිරීම
      await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', route => route.abort());

      // Network Traffic Sniffing
      page.on('response', response => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        if ((url.includes('.mp4') || url.includes('.m3u8') || contentType.includes('video')) && !capturedVideoUrl) {
          if (url.includes('cdn') || url.includes('novetechtg') || url.includes('playterabox') || url.includes('filesadda')) {
            capturedVideoUrl = url;
            console.log(`📡 [NETWORK DETECT] Video Stream Found!`);
          }
        }
      });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Play / Download Button Click Logic
      try {
        const btn = await page.$('button.btn.btn-download, .play-btn, #play-btn, video');
        if (btn) await btn.click();
      } catch (e) {}

      // DOM & Frame Search Fallback Loop
      for (let i = 1; i <= 15; i++) {
        if (capturedVideoUrl) break;

        for (const frame of page.frames()) {
          try {
            const src = await frame.$eval('video', v => v.src || (v.querySelector('source') ? v.querySelector('source').src : null));
            if (src && !src.startsWith('blob:')) {
              capturedVideoUrl = src;
              console.log(`🎯 [DOM DETECT] Video Tag Found!`);
              break;
            }
          } catch (e) {}
        }
        await page.waitForTimeout(1000);
      }

      await context.close();
      console.log(`🧹 [CLEANUP] Context closed successfully.`);

      if (capturedVideoUrl) {
        return res.json({ success: true, data: { videoUrl: capturedVideoUrl } });
      } else {
        return res.json({ success: false, error: 'Video URL not found' });
      }

    } catch (error) {
      if (context) await context.close();
      console.log(`💥 [ERROR] ${error.message}`);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(400).json({ success: false, error: 'Invalid action' });
});

app.listen(PORT, () => {
  console.log(`🚀 Playwright WebKit API Running on Port ${PORT}`);
});
