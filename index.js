const express = require('express');
const { webkit } = require('playwright');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 7860;
const API_SECRET = process.env.API_SECRET || "MY_SECRET_BOT_KEY_123";

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

  const { targetUrl, action, originalLink } = req.body;

  if (action === 'get_video_url') {
    console.log(`\n📩 [REQ RECEIVED] Target: ${targetUrl} | Original Link: ${originalLink || 'N/A'}`);
    let context = null;

    try {
      const browser = await getBrowser();
      
      // Mobile Safari Context Optimized for WebKit
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/605.1.15',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });

      const page = await context.newPage();
      let capturedVideoUrl = null;

      // Safe Route Aborting (Block heavy assets, keep CSS & Scripts)
      await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2}', route => {
        route.abort().catch(() => {});
      });

      // WebKit Optimized Safe Traffic Sniffer
      page.on('response', async response => {
        if (capturedVideoUrl) return;

        const url = response.url();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();

        // Direct Stream & CDN Detection via URL Pattern
        if (
          (url.includes('.mp4') || url.includes('.m3u8') || url.includes('stream') || contentType.includes('video')) &&
          !url.startsWith('blob:') &&
          !url.includes('.js') &&
          !url.includes('.css')
        ) {
          if (
            url.includes('cdn') || 
            url.includes('novetechtg') || 
            url.includes('playterabox') || 
            url.includes('terabox') || 
            url.includes('filesadda') || 
            url.includes('diskwala') ||
            url.includes('d.terabox') ||
            url.includes('telebox') ||
            url.includes('fastdl')
          ) {
            capturedVideoUrl = url;
            console.log(`🎯 [NETWORK DIRECT] Video Stream Found: ${url}`);
            return;
          }
        }

        // Safe JSON Payload Inspection for WebKit
        if (contentType.includes('json') || url.includes('/api/')) {
          try {
            const bodyText = await response.text().catch(() => '');
            if (bodyText) {
              const matches = bodyText.match(/https?:\/\/[^"\s\\]+(?:mp4|m3u8|cdn|stream|terabox|d\.terabox|playterabox|filesadda)[^"\s\\]*/gi);
              if (matches && matches.length > 0) {
                capturedVideoUrl = matches[0].replace(/\\/g, '');
                console.log(`🎯 [NETWORK JSON] Video Stream Found: ${capturedVideoUrl}`);
              }
            }
          } catch (e) {}
        }
      });

      // --- DISKWALA FLOW ---
      if (originalLink && (originalLink.includes('diskwala') || targetUrl.includes('sky577bot'))) {
        console.log(`🌐 [DISKWALA FLOW] Navigating to Mini App URL...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);

        console.log(`📝 Searching Diskwala Input Box...`);
        const inputSelector = 'input[placeholder*="Diskwala"], input[placeholder*="Link"], input[type="text"]';
        await page.waitForSelector(inputSelector, { timeout: 15000 });

        console.log(`✍️ Pasting Diskwala Link: ${originalLink}`);
        await page.fill(inputSelector, originalLink);
        await page.waitForTimeout(1000);

        console.log(`👆 Clicking Download Button...`);
        const downloadBtnSelector = 'button:has-text("Download"), input[type="submit"], .btn-download, button.btn-download';
        const downloadBtn = await page.$(downloadBtnSelector);

        if (downloadBtn) {
          await downloadBtn.click();
          console.log(`✅ Download Button Clicked!`);
        } else {
          await page.press(inputSelector, 'Enter');
          console.log(`⌨️ Pressed Enter on Input Field!`);
        }

      // --- NEBULA / TERABOX FLOW (FIXED FOR WEBKIT) ---
      } else {
        console.log(`🌐 [NEBULA FLOW] Navigating to Nebula URL...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForTimeout(3000);

        // Step 1: Click Main Play Button
        console.log(`▶️ Step 1: Clicking Play Button...`);
        const playBtnSelector = 'button.btn.btn-download, button:has-text("Play"), .btn-download, .play-btn';
        try {
          const playBtn = await page.$(playBtnSelector);
          if (playBtn) {
            await playBtn.click({ force: true });
            console.log(`✅ Play Button Clicked!`);
          }
        } catch (e) {}

        await page.waitForTimeout(3000);

        // Step 2: Dynamic Wait & Click Exact X / Close Button (Without destroying DOM)
        console.log(`⏳ Step 2: Monitoring Exact X Button...`);
        const exactXSelector = 'div[style*="background: rgb(43, 82, 120)"], div[style*="right: 1em"], .close-btn, div[class*="close"]';

        for (let second = 1; second <= 15; second++) {
          if (capturedVideoUrl) break;

          for (const frame of page.frames()) {
            try {
              const btn = await frame.$(exactXSelector);
              if (btn && await btn.isVisible()) {
                await btn.click({ force: true });
                console.log(`✅ Clicked exact X Button at ${second}s!`);
                break;
              }
            } catch (e) {}
          }
          await page.waitForTimeout(1000);
        }
      }

      // DOM & Frame Video Tag Search Fallback Loop
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
        
        if (!capturedVideoUrl) {
          await page.waitForTimeout(1000);
        }
      }

      await context.close();
      console.log(`🧹 [CLEANUP] Context closed successfully.`);

      if (capturedVideoUrl) {
        return res.json({ success: true, data: { videoUrl: capturedVideoUrl } });
      } else {
        return res.json({ success: false, error: 'Video URL not found' });
      }

    } catch (error) {
      if (context) {
        await context.close().catch(() => {});
      }
      console.log(`💥 [ERROR] ${error.message}`);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(400).json({ success: false, error: 'Invalid action' });
});

app.listen(PORT, () => {
  console.log(`🚀 Playwright WebKit API Running on Port ${PORT}`);
});
