import puppeteer from 'puppeteer';

(async () => {
  // 現在の日本時間を取得
  const date = new Date();
  const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  const message = `【BOT】${jstHours}時になりました。`;

  // ブラウザを起動（ヘッドレスモード）
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // サイトにアクセス
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // ログイン情報の入力
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    await page.type('#a-handle', 'kakuzatou');
    await page.type('#a-pass', 't20120627');

    // ログインボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input.btn, .btn');
      for (let el of buttons) {
        if ((el.innerText || el.value || '').trim() === 'ログイン') {
          el.click();
          break;
        }
      }
    });

    // ログイン後の画面切り替えを待つ
    await new Promise(r => setTimeout(r, 4000));

    // 投稿欄にメッセージを入力
    await page.waitForSelector('#c-body', { timeout: 5000 });
    await page.type('#c-body', message);

    // 投稿ボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input.btn');
      for (let btn of buttons) {
        if ((btn.innerText || btn.value || '').trim() === '投稿') {
          btn.click();
          break;
        }
      }
    });

    // 投稿が完了するのを少し待つ
    await new Promise(r => setTimeout(r, 3000));
    console.log("投稿成功: " + message);

  } catch (error) {
    console.error("エラー発生: ", error);
  } finally {
    await browser.close();
  }
})();
