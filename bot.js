import puppeteer from 'puppeteer';

(async () => {
  const date = new Date();
  const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
  const message = `【アナウンス】${jstHours}時になりました。`;

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
    await new Promise(r => setTimeout(r, 6000));

    // ★ 5. 「スキップ」ボタン（クラス: btn ghost small）をピンポイントでクリックして閉じる
    const skipClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = (btn.innerText || '').trim();
        const className = btn.className || '';
        if (text === 'スキップ' && className.includes('btn') && className.includes('ghost')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (skipClicked) {
      console.log("「スキップ」ボタンをクリックしました。");
    } else {
      console.log("「スキップ」ボタンが見つからなかったため、そのまま進みます。");
    }
    
    await new Promise(r => setTimeout(r, 2000));

    // 6. 投稿欄の出現を待つ
    await page.waitForSelector('#c-body', { timeout: 10000 });
    console.log("投稿欄を発見！メッセージを入力します...");

    await page.type('#c-body', message, { delay: 50 });
    await new Promise(r => setTimeout(r, 1000));

    // ★ 7. 「投稿」ボタン（テキスト「投稿」、クラス「btn」）をピンポイントでクリック
    const postClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        const className = btn.className || '';
        // ほかのボタン（「投稿する」など）と混ざらないよう、厳密に「投稿」というテキストに一致させる
        if (text === '投稿' && className.includes('btn')) {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
            btn.dispatchEvent(new PointerEvent(eventType, { bubbles: true, cancelable: true, view: window }));
          });
          return true;
        }
      }
      return false;
    });

    if (!postClicked) {
      throw new Error("投稿ボタンが見つかりませんでした");
    }

    console.log("投稿ボタンをクリックしました。");

    // 8. 結果確認用のスクショを保存
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'success-result.png', fullPage: true });
    console.log("処理が完了しました。");

  } catch (error) {
    console.error("エラー発生: ", error);
    await page.screenshot({ path: 'error-debug.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
