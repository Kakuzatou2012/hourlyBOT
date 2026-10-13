import puppeteer from 'puppeteer';

(async () => {
  const date = new Date();
  const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  const message = `【BOT】${jstHours}時になりました。`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // 1. サイトにアクセス
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // 2. ログイン情報の入力（IDとパスワード）
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    await page.type('#a-handle', 'kakuzatou');
    await page.type('#a-pass', 't20120627');

    // 3. 「ログイン」ボタンを確実にクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('ログイン')) {
          btn.click();
          break;
        }
      }
    });

    // 4. ログイン後の画面に切り替わるのをしっかり待つ
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // 5. 投稿欄が表示されるのを待つ
    await page.waitForSelector('#c-body', { timeout: 10000 });
    await page.type('#c-body', message);

    // 6. 「投稿」ボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('投稿')) {
          btn.click();
          break;
        }
      }
    });

    await new Promise(r => setTimeout(r, 3000));
    console.log("投稿成功: " + message);

  } catch (error) {
    console.error("エラー発生: ", error);
  } finally {
    await browser.close();
  }
})();
