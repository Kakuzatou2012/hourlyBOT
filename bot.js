import puppeteer from 'puppeteer';

(async () => {
  const date = new Date();
  const jstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  const message = `【全国アナウンス（BOT）】${jstHours}時になりました。`;

  console.log(`現在のJST時刻: ${jstHours}時${jstMinutes}分`);

  // ⚠️ ピッタシの時間（0分）のときだけ投稿するガード
  // ※もしGitHub Actionsのcronの遅延を考慮するなら jstMinutes <= 1 とかにしてもOK
  const isExactHour = (jstMinutes === 0);

  if (!isExactHour) {
    console.log(`【ガード発動】現在は ${jstMinutes}分 のため、定刻（0分）ではないため投稿をスキップします。`);
  }

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

    // 5. 「スキップ」ボタンをピンポイントでクリックして閉じる
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
    }
    
    await new Promise(r => setTimeout(r, 2000));

    // 6. 投稿欄の出現を待つ
    await page.waitForSelector('#c-body', { timeout: 10000 });
    console.log("投稿欄を発見！メッセージを入力します...");

    await page.type('#c-body', message, { delay: 50 });
    await new Promise(r => setTimeout(r, 1000));

    // 7. 定刻（0分）じゃなければここでストップ
    if (!isExactHour) {
      console.log("テスト実行または定刻外のため、投稿ボタンは押さずに終了します。");
      await page.screenshot({ path: 'success-result.png', fullPage: true });
      return;
    }

    // 8. 「投稿」ボタンをクリック（定刻のときだけ実行される）
    const postClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        const className = btn.className || '';
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

    // 9. 結果確認用のスクショを保存
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
