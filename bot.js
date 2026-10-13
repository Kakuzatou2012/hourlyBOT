import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // 1. サイトにアクセス
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // 2. IDとパスワード入力
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

    // 3. ログインボタンをクリック
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, input.btn, .btn');
      for (let el of buttons) {
        const text = (el.innerText || el.value || '').trim();
        const className = el.className || '';
        if (text === 'ログイン' && className.includes('btn') && !className.includes('tab')) {
          el.click();
          const form = el.closest('form');
          if (form) form.submit();
          break;
        }
      }
    });

    // 4. クリック直後の画面をスクショに保存（ここでどうなっているか確認）
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: 'error-debug.png', fullPage: true });
    console.log("ログイン後の画面をスクショ保存したよ");

    // 5. 投稿欄を待つ
    await page.waitForSelector('#c-body', { timeout: 5000 });

  } catch (error) {
    console.error("エラー発生: ", error);
    await page.screenshot({ path: 'error-debug.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
