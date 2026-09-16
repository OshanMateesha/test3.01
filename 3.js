const express = require('express');
const { webkit } = require('playwright');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 7860;
const API_SECRET = "MY_SECRET_BOT_KEY_123";

// SQLite DB initialize කිරීම
const db = new Database('requests.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS extractions (
    url_hash TEXT PRIMARY KEY,
    target_url TEXT,
    status TEXT,
    video_url TEXT,
    created_at INTEGER
  )
`);

// Target URL එක වෙනුවෙන් Unique Hash එකක් සෑදීම
function getHash(text) {
  return crypto.createHash('md5').update(text || '').digest('hex');
}

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

  const { targetUrl, action, originalLink, serviceType } = req.body;

  if (action === 'get_video_url') {
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'targetUrl is required' });
    }

    // Hash එක සෑදීම (Diskwala සඳහා originalLink ද එකතු කරගනී)
    const uniqueKey = targetUrl + (originalLink || '');
    const urlHash = getHash(uniqueKey);
    const currentTime = Math.floor(Date.now() / 1000);

    // ==========================================
    // 🔹 DB CACHE & PENDING CHECK
    // ==========================================
    const cachedEntry = db.prepare('SELECT * FROM extractions WHERE url_hash = ?').get(urlHash);

    if (cachedEntry) {
      // 1. දැනටමත් Extract කර ඇති Link එකක් නම් Instant Return කිරීම
      if (cachedEntry.status === 'success' && cachedEntry.video_url) {
        console.log(`⚡ [CACHE HIT] Instant Video URL Returned for Hash: ${urlHash}`);
        return res.json({ 
          success: true, 
          cached: true, 
          data: { videoUrl: cachedEntry.video_url } 
        });
      }

      // 2. දැනටමත් Processing වෙන ගමන් නම් Dual Processing වැළැක්වීම
      if (cachedEntry.status === 'pending') {
        if (currentTime - cachedEntry.created_at < 60) {
          console.log(`⏳ [DUPLICATE BLOCKED] Request already in progress for Hash: ${urlHash}`);
          return res.status(429).json({ 
            success: false, 
            error: 'Request is already being processed. Please wait.' 
          });
        }
      }
    }

    // 3. Request එක Processing ලෙස DB එකේ Mark කිරීම
    db.prepare(`
      INSERT INTO extractions (url_hash, target_url, status, video_url, created_at)
      VALUES (?, ?, 'pending', NULL, ?)
      ON CONFLICT(url_hash) DO UPDATE SET status='pending', created_at=?
    `).run(urlHash, targetUrl, currentTime, currentTime);

    console.log(`\n📩 [REQ RECEIVED] Processing Target: ${targetUrl}`);
    let context = null;
    let page = null;

    try {
      const browser = await getBrowser();
      
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        viewport: { width: 412, height: 915 }
      });
      page = await context.newPage();

      let capturedVideoUrl = null;

      // Unnecessary Assets Block කිරීම
      await page.route('**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}', route => route.abort().catch(() => {}));

      // Network Traffic Sniffing
      page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        // Direct Stream Detection
        if ((url.includes('.mp4') || url.includes('.m3u8') || contentType.includes('video')) && !capturedVideoUrl) {
          if (url.includes('cdn') || url.includes('novetechtg') || url.includes('playterabox') || url.includes('filesadda') || url.includes('diskwala')) {
            capturedVideoUrl = url;
            console.log(`📡 [NETWORK DETECT] Video Stream Found: ${url}`);
          }
        }

        // Diskwala API Response Sniffing
        if ((url.includes('/api/') || url.includes('diskwala') || url.includes('get_file')) && !capturedVideoUrl) {
          try {
            const json = await response.json();
            const streamUrl = json?.url || json?.download_url || json?.data?.stream_url || json?.data?.fast_download_url || json?.link;
            if (streamUrl && (streamUrl.includes('http') || streamUrl.includes('.mp4'))) {
              capturedVideoUrl = streamUrl;
              console.log(`📡 [API DETECT] Found Stream URL in JSON Response: ${capturedVideoUrl}`);
            }
          } catch (e) {}
        }
      });

      const isDiskwala = serviceType === 'diskwala' || 
                         (originalLink && originalLink.includes('diskwala')) || 
                         (targetUrl && targetUrl.includes('diskwala'));

      if (isDiskwala) {
        // DISKWALA FLOW
        console.log(`🌀 [FLOW] Executing Diskwala Extractor...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });
        await page.waitForTimeout(3000);

        const inputSelector = 'input[type="text"], input[placeholder*="Link"], input[placeholder*="Diskwala"], input';
        await page.waitForSelector(inputSelector, { timeout: 15000 });

        console.log(`✍️ Filling Diskwala Link: ${originalLink}`);
        await page.fill(inputSelector, originalLink || '');
        await page.waitForTimeout(1000);

        await page.press(inputSelector, 'Enter').catch(() => {});

        const buttonSelectors = [
          'button:has-text("Download")',
          'button:has-text("Get")',
          'button:has-text("Submit")',
          '.btn-download',
          'button[type="submit"]',
          'button'
        ];

        for (const selector of buttonSelectors) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click({ force: true });
              await page.$eval(selector, el => el.click()).catch(() => {});
              console.log(`✅ Diskwala Button Clicked (${selector})`);
              break;
            }
          } catch (e) {}
        }

      } else {
        // NEBULA / TERABOX FLOW
        console.log(`🌀 [FLOW] Executing Nebula Extractor...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });
        await page.waitForTimeout(10000);

        const buttonSelector = 'button.btn-download';
        try {
          await page.waitForSelector(buttonSelector, { state: 'visible', timeout: 15000 });
          await page.click(buttonSelector, { force: true });
          console.log('✅ Clicked Nebula button.btn-download via Playwright!');

          await page.$eval(buttonSelector, btn => btn.click()).catch(() => {});
        } catch (e) {
          console.log(`⚠️ Nebula Button Fallback Triggered: ${e.message}`);
          await page.evaluate(() => {
            const btn = document.querySelector('button.btn-download') || document.querySelector('.btn-download');
            if (btn) btn.click();
          }).catch(() => {});
        }
      }

      // STREAM CAPTURE SCAN LOOP (35s MAX)
      console.log('⏳ Waiting for Video Stream response (35s max)...');
      for (let i = 1; i <= 35; i++) {
        if (capturedVideoUrl) {
          console.log(`🎉 [SUCCESS] Captured Video Link in ${i} seconds!`);
          break;
        }

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
        // Success වෙන අවස්ථාවේ DB එක update කිරීම
        db.prepare(`
          UPDATE extractions SET status = 'success', video_url = ? WHERE url_hash = ?
        `).run(capturedVideoUrl, urlHash);

        return res.json({ success: true, data: { videoUrl: capturedVideoUrl } });
      } else {
        // Link එක හමු නොවුණහොත් failed ලෙස සලකුණු කිරීම
        db.prepare(`UPDATE extractions SET status = 'failed' WHERE url_hash = ?`).run(urlHash);
        return res.json({ success: false, error: 'Video URL not found within timeout' });
      }

    } catch (error) {
      if (context) await context.close().catch(() => {});
      console.log(`💥 [ERROR] ${error.message}`);
      
      // Error එකක් ආ විට DB එක failed කිරීම
      db.prepare(`UPDATE extractions SET status = 'failed' WHERE url_hash = ?`).run(urlHash);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(400).json({ success: false, error: 'Invalid action' });
});

app.listen(PORT, () => {
  console.log(`🚀 Playwright WebKit API Running on Port ${PORT}`);
});
