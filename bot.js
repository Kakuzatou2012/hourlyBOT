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
    // サイトにアクセス
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // ログインフォームの入力
    await page.waitForSelector('#a-handle', { timeout: 10000 });
    
    await page.evaluate(() => {
      const handleInput = document.getElementById('a-handle');
      const passInput = document.getElementById('a-pass');
      
      handleInput.value = 'kakuzatou';
      handleInput.dispatchEvent(new Event('input', { bubbles: true }));
      handleInput.dispatchEvent(new Event('change', { bubbles: true }));

      passInput.value = 't20120627';
      passInput.dispatchEvent(new Event('input', { bubbles: true }));
      passInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // ログインボタンのクリックとサブミット
    const loginSuccess = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input.btn, .btn');
      let targetBtn = null;

      for (let el of buttons) {
        const text = (el.innerText || el.value || '').trim();
        const className = el.className || '';
        if (text === 'ログイン' && className.includes('btn') && !className.includes('tab')) {
          targetBtn = el;
          break;
        }
      }

      if (targetBtn) {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
          targetBtn.dispatchEvent(new PointerEvent(eventType, { bubbles: true, cancelable: true, view: window }));
        });
        const form = targetBtn.closest('form');
        if (form) {
          form.submit();
        }
        return true;
      }
      return false;
    });

    if (!loginSuccess) {
      throw new Error("本物のログインボタンが見つからなかった");
    }

    // 画面遷移を待つ
    await new Promise(r => setTimeout(r, 4000));

    // 投稿欄の出現を待ってメッセージを入力
    await page.waitForSelector('#c-body', { timeout: 10000 });
    await page.type('#c-body', message);

    // 投稿ボタンをクリック
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
    // デバッグ用にエラー時の画面をスクショ保存
    await page.screenshot({ path: 'error-debug.png' }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
