import puppeteer from 'puppeteer';

(async () => {
  const date = new Date();
  const jstDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  console.log(`【送金テストBOT】現在のJST時刻: ${jstHours}時${jstMinutes}分`);

  // 0〜3分以内のガード（テスト時は必要なら外してね）
  if (jstMinutes > 3) {
    console.log(`【ガード発動】現在は ${jstMinutes}分 のためスキップします。`);
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  try {
    // 1. サイトを開く
    await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });

    // 2. ログイン処理
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

    // 3. スキップ処理
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
    
    await new Promise(r => setTimeout(r, 3000));

    // 4. 「コインを送る」ボタン（#send）を押す
    const sendClicked = await page.evaluate(() => {
      const sendBtn = document.getElementById('send');
      if (sendBtn) {
        sendBtn.click();
        return true;
      }
      return false;
    });

    if (!sendClicked) throw new Error("「コインを送る」ボタンが見つかりませんでした");

    await new Promise(r => setTimeout(r, 1500));

    // 5. モーダル内に「zav」「1」「【BOT】送金テスト」を入力
    await page.waitForSelector('#mf-h', { timeout: 5000 });

    await page.evaluate(() => {
      const hInput = document.getElementById('mf-h');
      const aInput = document.getElementById('mf-a');
      const mInput = document.getElementById('mf-m');

      if (hInput) hInput.value = 'zav';
      if (aInput) aInput.value = 1;
      if (mInput) mInput.value = '【BOT】送金テスト';

      [hInput, aInput, mInput].forEach(input => {
        if (input) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    // 6. 確定ボタン（#modal-ok）を押す
    const okClicked = await page.evaluate(() => {
      const okBtn = document.getElementById('modal-ok');
      if (okBtn) {
        okBtn.click();
        return true;
      }
      return false;
    });

    if (!okClicked) throw new Error("送金確定ボタンが見つかりませんでした");

    console.log("zavさんへの送金完了！");
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'transfer-success.png', fullPage: true });

  } catch (error) {
    console.error("エラー発生: ", error);
    await page.screenshot({ path: 'error-debug.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})();
