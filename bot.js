import puppeteer from 'puppeteer';

(async () => {
  const date = new Date();
  const jstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  console.log(`現在のJST時刻: ${jstHours}時${jstMinutes}分`);

  const isExactHour = (jstMinutes === 0);
  if (!isExactHour) {
    console.log(`【ガード発動】現在は ${jstMinutes}分 のため投稿をスキップします。`);
    return;
  }

  // 時間によって投稿内容を切り替える
  let message = '';
  let isMorningBot = (jstHours === 4);

  if (isMorningBot) {
    message = `【全国アナウンス（BOT）】\nおはよう！\n朝4時に 何してるんだい？`;
  } else {
    message = `【全国アナウンス（BOT）】${jstHours}時になりました。`;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // ログイン処理
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    await page.click('#a-handle');
    await page.type('#a-handle', 'kakuzatou', { delay: 50 });

    await page.click('#a-pass');
    await page.type('#a-pass', 't20120627', { delay: 50 });

    await new Promise(r => setTimeout(r, 1000));

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

    if (!loginClicked) throw new Error("ログインボタンが見つかりませんでした");

    await new Promise(r => setTimeout(r, 6000));

    // スキップ処理
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        if ((btn.innerText || '').trim() === 'スキップ' && btn.className.includes('ghost')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    await new Promise(r => setTimeout(r, 2000));

    // メッセージ入力
    await page.waitForSelector('#c-body', { timeout: 10000 });
    await page.type('#c-body', message, { delay: 50 });
    await new Promise(r => setTimeout(r, 1000));

    // 朝4時なら画像を添付する
    if (isMorningBot) {
      console.log("朝4時のため、画像を添付します...");
      const input = await page.$('input[type="file"]');
      if (input) {
        await input.uploadFile('./george.jpg');
        console.log("画像をセットしました！");
      } else {
        console.log("⚠️ ファイル選択要素が見つかりませんでした");
      }
      await new Promise(r => setTimeout(r, 2000));

      // 添付直後のスクショ
      await page.screenshot({ path: 'debug-uploaded.png', fullPage: true });
      console.log("添付直後のスクショを保存しました。");
    }

    // 投稿ボタンをクリック
    const postClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (let btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (text === '投稿' && btn.className.includes('btn')) {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
            btn.dispatchEvent(new PointerEvent(eventType, { bubbles: true, cancelable: true, view: window }));
          });
          return true;
        }
      }
      return false;
    });

    if (!postClicked) throw new Error("投稿ボタンが見つかりませんでした");

    console.log("投稿ボタンをクリックしました。");
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'success-result.png', fullPage: true });

  } catch (error) {
    console.error("エラー発生: ", error);
    await page.screenshot({ path: 'error-debug.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
