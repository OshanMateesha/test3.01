const express = require('express');
const { webkit } = require('playwright');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 7860;
const API_SECRET = process.env.API_SECRET || "MY_SECRET_BOT_KEY_123";

const DEFAULT_DISKWALA_MINIAPP = 'https://miniapp.diskwala.net/#tgWebAppData=query_id%3DAAFo90ETAwAAAGj3QROSBOVo%26user%3D%257B%2522id%2522%253A6765541224%252C%2522first_name%2522%253A%2522Hi%2522%252C%2522last_name%2522%253A%2522%2522%252C%2522language_code%2522%253A%2522en%2522%252C%2522allows_write_to_pm%2522%253Atrue%252C%2522photo_url%2522%253A%2522https%253A%255C%252F%255C%252Ft.me%255C%252Fi%255C%252Fuserpic%255C%252F320%255C%252FFeIhljcgrFp29c7G87lcU7aUm9PbPwK0gsWw6lvnYU4vKLWIUaWNUsdkTNxunkz8.svg%2522%257D%26auth_date%3D1789470546%26signature%3DjXgAfTqEQRWdu8c6ZGqXQsO-YdTCF6ByrteHHJ9kK8UeChRNgC1rO54sITXKHdnhXe-7iEgWzJdpQs3S0mgWDg%26hash%3De0c7cecfafec055823e9d975adcf6025c1a57eb4c2654a22501a36b7783354db&tgWebAppVersion=9.6&tgWebAppPlatform=web&tgWebAppThemeParams=%7B%22bg_color%22%3A%22%23212121%22%2C%22button_color%22%3A%22%238774e1%22%2C%22button_text_color%22%3A%22%23ffffff%22%2C%22hint_color%22%3A%22%23aaaaaa%22%2C%22link_color%22%3A%22%238774E1%22%2C%22secondary_bg_color%22%3A%22%23181818%22%2C%22text_color%22%3A%22%23ffffff%22%2C%22header_bg_color%22%3A%22%23212121%22%2C%22accent_text_color%22%3A%22%238774e1%22%2C%22section_bg_color%22%3A%22%23212121%22%2C%22section_header_text_color%22%3A%22%238774e1%22%2C%22subtitle_text_color%22%3A%22%23aaaaaa%22%2C%22destructive_text_color%22%3A%22%23ff595a%22%7D';

let globalBrowser = null;

async function getBrowser() {
  if (!globalBrowser || !globalBrowser.isConnected()) {
    console.log('🌐 Launching WebKit Browser Engine...');
    globalBrowser = await webkit.launch({ headless: true });
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
      
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        viewport: { width: 412, height: 915 }
      });

      const page = await context.newPage();
      let capturedVideoUrl = null;

      // Pop-up Ads Auto-Close
      context.on('page', async (newPage) => {
        if (newPage !== page) {
          console.log(`⚠️ [POPUP DETECTED] Auto-closing ad window: ${newPage.url()}`);
          await page.waitForTimeout(500);
          await newPage.close().catch(() => {});
        }
      });

      // Static asset blocking
      await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2}', route => route.abort().catch(() => {}));

      // Network Traffic & API Sniffer
      page.on('response', async response => {
        if (capturedVideoUrl) return;

        const resUrl = response.url();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();

        if ((resUrl.includes('.mp4') || resUrl.includes('.m3u8') || contentType.includes('video')) && !resUrl.startsWith('blob:') && !resUrl.includes('.js') && !resUrl.includes('.css')) {
          capturedVideoUrl = resUrl;
          console.log(`🎯 [STREAM DETECTED] Direct Video URL: ${resUrl}`);
          return;
        }

        if ((contentType.includes('json') || resUrl.includes('/api/') || resUrl.includes('diskwala')) && !capturedVideoUrl) {
          try {
            const bodyText = await response.text().catch(() => '');
            if (bodyText) {
              try {
                const json = JSON.parse(bodyText);
                const streamUrl = json?.url || json?.download_url || json?.data?.stream_url || json?.link;
                if (streamUrl && (streamUrl.includes('http') || streamUrl.includes('.mp4'))) {
                  capturedVideoUrl = streamUrl;
                  console.log(`🎯 [API JSON] Stream URL found: ${capturedVideoUrl}`);
                  return;
                }
              } catch (e) {}

              const matches = bodyText.match(/https?:\/\/[^"\s\\]+(?:mp4|m3u8|cdn|stream|terabox|d\.terabox|playterabox|filesadda|diskwala)[^"\s\\]*/gi);
              if (matches && matches.length > 0) {
                capturedVideoUrl = matches[0].replace(/\\/g, '');
                console.log(`🎯 [REGEX JSON] Stream URL found: ${capturedVideoUrl}`);
              }
            }
          } catch (e) {}
        }
      });

      const isDiskwala = (originalLink && originalLink.includes('diskwala')) || (targetUrl && targetUrl.includes('diskwala'));

      if (isDiskwala) {
        console.log(`🌐 [DISKWALA FLOW] Navigating to Mini App URL...`);
        const finalTargetUrl = targetUrl || DEFAULT_DISKWALA_MINIAPP;
        const finalOriginalLink = originalLink || targetUrl;

        await page.goto(finalTargetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(4000);

        console.log(`🔍 Locating Diskwala Input Field...`);
        const inputSelector = 'input[type="text"], input[placeholder*="Link"], input[placeholder*="Diskwala"], input';
        await page.waitForSelector(inputSelector, { timeout: 15000 });

        console.log(`✍️ Typing Diskwala Link: ${finalOriginalLink}`);
        await page.fill(inputSelector, finalOriginalLink);
        await page.waitForTimeout(1000);

        console.log(`⌨️ Pressing Enter Key...`);
        await page.press(inputSelector, 'Enter').catch(() => {});
        await page.waitForTimeout(1000);

        console.log(`👆 Searching & Clicking Download Button...`);
        const buttonSelectors = [
          'button:has-text("Download")',
          'button:has-text("Get")',
          'button:has-text("Submit")',
          '.btn-download',
          'button.btn',
          'button[type="submit"]',
          'button'
        ];

        let clicked = false;
        for (const selector of buttonSelectors) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click({ force: true });
              console.log(`✅ Clicked button: ${selector}`);
              await page.$eval(selector, el => el.click()).catch(() => {});
              clicked = true;
              break;
            }
          } catch (e) {}
        }

        if (!clicked) {
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"], a.btn'));
            btns.forEach(b => b.click());
          }).catch(() => {});
        }

      } else {
        console.log(`🌀 [NEBULA FLOW] Executing Nebula Extractor...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });
        await page.waitForTimeout(8000);

        const buttonSelector = 'button.btn-download';
        try {
          await page.waitForSelector(buttonSelector, { state: 'visible', timeout: 15000 });
          await page.click(buttonSelector, { force: true });
          console.log('✅ Clicked Nebula button.btn-download!');
          await page.$eval(buttonSelector, btn => btn.click()).catch(() => {});
        } catch (e) {
          console.log(`⚠️ Nebula Button Fallback Triggered: ${e.message}`);
          await page.evaluate(() => {
            const btn = document.querySelector('button.btn-download') || document.querySelector('.btn-download');
            if (btn) btn.click();
          }).catch(() => {});
        }
      }

      // Stream Wait Scan Loop (Up to 35s)
      for (let i = 1; i <= 35; i++) {
        if (capturedVideoUrl) {
          console.log(`🎉 [SUCCESS] Direct Video Link Captured at ${i} seconds!`);
          break;
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
