import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // 1. サイトにアクセス
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // 2. ログイン情報の入力
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    await page.type('#a-handle', 'kakuzatou');
    await page.type('#a-pass', 't20120627');

    // 3. ログインボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('ログイン')) {
          btn.click();
          break;
        }
      }
    });

    // 4. 3秒待ってからスクリーンショットを撮影（現状確認用）
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'login-debug.png' });
    console.log("スクリーンショットを保存しました");

    // 5. 投稿欄を探す
    await page.waitForSelector('#c-body', { timeout: 5000 });
    console.log("投稿欄を発見！");

  } catch (error) {
    console.error("エラー発生: ", error);
    // エラー時も今の画面をスクショに残す
    await page.screenshot({ path: 'error-debug.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
