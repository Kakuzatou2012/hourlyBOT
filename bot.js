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

    // 2. ログイン情報の入力
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    
    await page.click('#a-handle');
    await page.type('#a-handle', 'kakuzatou', { delay: 50 });

    await page.click('#a-pass');
    await page.type('#a-pass', 't20120627', { delay: 50 });

    await new Promise(r => setTimeout(r, 1000));

    // 3. ログインボタンをクリック
    const loginClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input.btn, .btn');
      for (let el of buttons) {
        const text = (el.innerText || el.value || '').trim();
        const className = el.className || '';
        if (text === 'ログイン' && className.includes('btn') && !className.includes('tab')) {
          el.click();
          return true;
        }
      }
      return false;
    });

    if (!loginClicked) {
      throw new Error("ログインボタンが見つかりませんでした");
    }

    // 4. ログイン後の画面切り替えを待つ
    console.log("ログインボタンを押しました。画面切り替えを待ちます...");
    await new Promise(r => setTimeout(r, 5000));

    // 5. ポップアップの「スキップ」などを探して閉じる
    await page.evaluate(() => {
      const elements = document.querySelectorAll('button, div, span, a');
      for (let el of elements) {
        const text = (el.innerText || '').trim();
        if (text === 'スキップ' || text === '×' || text === '閉じる' || text === 'OK') {
          el.click();
          break;
        }
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    // 6. 投稿欄の出現を待つ
    await page.waitForSelector('#c-body', { timeout: 10000 });
    console.log("投稿欄を発見！メッセージを入力します...");

    await page.type('#c-body', message, { delay: 50 });

    // 7. 投稿ボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if (btn.textContent.includes('投稿')) {
          btn.click();
          break;
        }
      }
    });

    // 8. 結果確認用のスクショを保存
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'success-result.png', fullPage: true });
    console.log("投稿処理が完了しました。");

  } catch (error) {
    console.error("エラー発生: ", error);
    await page.screenshot({ path: 'error-debug.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
