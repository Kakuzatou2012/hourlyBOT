import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (強化版 v2)
 * - 通常時報（毎時）および朝4時の画像付き投稿を自動判定
 * - リトライ機構、スマートDOM待機、Ubuntu標準Chrome利用対応
 */

// 時刻ごとの挨拶メッセージ生成
function createAnnouncementMessage(hour, useRichText = true) {
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に 何してるんだい？\n#全国アナウンスBOT";
  }

  if (!useRichText) {
    return `【全国アナウンス（BOT）】\n${hour}時になりました。\n#全国アナウンスBOT`;
  }

  let greeting = "";
  if (hour >= 5 && hour <= 8) greeting = "おはようございます！今日も素敵な1日を。";
  else if (hour >= 9 && hour <= 11) greeting = "午前中もマイペースに応援しています！";
  else if (hour === 12) greeting = "お昼になりました！しっかり休憩＆エネルギー補給しましょう🍱";
  else if (hour === 15) greeting = "3時のおやつ時です☕ ひと息ついてリフレッシュを！";
  else if (hour >= 18 && hour <= 20) greeting = "今日もお疲れ様でした！";
  else if (hour >= 21 && hour <= 23) greeting = "夜更かしはほどほどに、暖かくしてお休みください🌙";
  else if (hour >= 0 && hour <= 3) greeting = "深夜の静かな時間です。良い夢を💤";
  else greeting = "素敵な時間をお過ごしください！";

  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n${greeting}\n#全国アナウンスBOT`;
}

// 投稿処理本体（リトライ対応）
async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  console.log(`[BOT実行] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  // 遅延許容判定: 10分以内の遅れなら投稿を実行
  if (jstMinutes > 10) {
    console.log(`⚠️ [ガード発動] 開始時刻が ${jstMinutes}分 と遅延しているため投稿をスキップします。`);
    return;
  }

  const isMorningBot = (jstHours === 4);
  const message = createAnnouncementMessage(jstHours, true);

  // GitHub Actions の ubuntu-latest にインストール済みの Chrome を利用（高速化）
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("SNSへアクセス中...");
    await page.goto('https://national-sns.vercel.app', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 1. ログイン入力
    await page.waitForSelector('#a-handle', { timeout: 15000 });
    await page.type('#a-handle', process.env.SNS_USER || '', { delay: 30 });

    await page.waitForSelector('#a-pass', { timeout: 10000 });
    await page.type('#a-pass', process.env.SNS_PASS || '', { delay: 30 });

    // ログインボタンの待機＆クリック
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button, input.btn, .btn'));
      return btns.some(el => {
        const text = (el.innerText || el.value || '').trim();
        const cls = el.className || '';
        return text === 'ログイン' && cls.includes('btn') && !cls.includes('tab');
      });
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input.btn, .btn'));
      for (const el of btns) {
        const text = (el.innerText || el.value || '').trim();
        const cls = el.className || '';
        if (text === 'ログイン' && cls.includes('btn') && !cls.includes('tab')) {
          el.click();
          return;
        }
      }
    });

    // 2. ログイン後の画面遷移待機（投稿欄またはスキップボタン出現を待機）
    await page.waitForFunction(() => {
      const postBox = document.querySelector('#c-body');
      const skipBtn = Array.from(document.querySelectorAll('button')).find(
        b => (b.innerText || '').trim() === 'スキップ' && b.className.includes('ghost')
      );
      return !!postBox || !!skipBtn;
    }, { timeout: 20000 });

    // スキップボタンが存在すればクリック
    const skipped = await page.evaluate(() => {
      const skipBtn = Array.from(document.querySelectorAll('button')).find(
        b => (b.innerText || '').trim() === 'スキップ' && b.className.includes('ghost')
      );
      if (skipBtn) {
        skipBtn.click();
        return true;
      }
      return false;
    });
    if (skipped) {
      console.log("スキップボタンをクリックしました。");
      await new Promise(r => setTimeout(r, 1500));
    }

    // 3. メッセージ入力
    await page.waitForSelector('#c-body', { timeout: 15000 });
    await page.type('#c-body', message, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    // 4. 朝4時の場合は画像を添付
    if (isMorningBot) {
      const imagePath = path.resolve('./george.jpg');
      if (fs.existsSync(imagePath)) {
        console.log(`朝4時限定: 画像を添付します (${imagePath})...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          console.log("画像を添付しました。");
          await new Promise(r => setTimeout(r, 2000));
        }
      } else {
        console.warn("⚠️ george.jpg が見つかりませんでした。画像なしで投稿します。");
      }
    }

    // 5. 投稿ボタンをクリック
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text === '投稿' && b.className.includes('btn');
      });
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (text === '投稿' && btn.className.includes('btn')) {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
            btn.dispatchEvent(new PointerEvent(evt, { bubbles: true, cancelable: true, view: window }));
          });
          return true;
        }
      }
    });

    console.log("投稿完了待機中...");
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'success-result.png', fullPage: true });
    console.log("🎉 投稿が完了しました！");

  } catch (error) {
    console.error(`❌ エラー発生 (試行 ${retryCount + 1}): `, error.message);
    await page.screenshot({ path: `error-debug-attempt-${retryCount + 1}.png`, fullPage: true }).catch(() => {});

    if (retryCount < maxRetries) {
      console.log(`🔄 5秒後にリトライします (${retryCount + 1}/${maxRetries})...`);
      await browser.close();
      await new Promise(r => setTimeout(r, 5000));
      return executeBotPost(retryCount + 1);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

// 実行開始
executeBotPost().catch(err => {
  console.error("致命的エラーで終了しました:", err);
  process.exit(1);
});
