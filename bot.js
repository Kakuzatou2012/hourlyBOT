import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (強化版 v3 - タイピング選手権 ＆ 5コイン自動配布対応)
 * - 毎時: タイピング選手権アナウンス ＆ 最速正解者に5コイン自動送金
 * - 朝4時限定: 画像付きおはようアナウンス (george.jpg)
 * - 国家 ➔ 経済 ➔ コインを送る (#send) ➔ #mf-h, #mf-a, #mf-m, #modal-ok 自動処理
 */

// タイピング選手権のお題キーワード集
const KEYWORDS = [
  "ねこじゃらし",
  "マスカット",
  "ひまわり畑",
  "きつねうどん",
  "たいやき",
  "青空レストラン",
  "流星群",
  "メロンソーダ",
  "アイスコーヒー",
  "カスタードプリン",
  "かき氷いちご味",
  "オムライス",
  "ホットケーキ",
  "桜吹雪",
  "シュークリーム",
  "チョコレートパフェ",
  "星空キャンプ",
  "クリームソーダ",
  "富士山頂",
  "一番星"
];

function getRandomKeyword() {
  return KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
}

// 投稿メッセージ生成
function createPostMessage(hour, keyword) {
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に 何してるんだい？\n#全国アナウンスBOT";
  }

  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n\n【イベント】\nタイピング選手権\n次のワードを最速で投稿したユーザーには\n5コインを配布します！\nキーワード\n『${keyword}』\n#全国アナウンスBOT`;
}

// 投稿ボタンクリック共通処理
async function clickPostButton(page) {
  await page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => {
      const text = (b.innerText || b.textContent || '').trim();
      return text === '投稿' && b.className.includes('btn');
    });
  }, { timeout: 10000 });

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    for (const btn of btns) {
      const text = (btn.innerText || btn.textContent || '').trim();
      if (text === '投稿' && btn.className.includes('btn')) {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
          btn.dispatchEvent(new PointerEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });
        return;
      }
    }
  });
}

// 勝者へ5コインを送金する処理 (国家 > 経済 > コインを送る)
async function sendCoinsToWinner(page, handle) {
  console.log(`💰 @${handle} さんへ5コインを送金開始...`);

  // 1. 「国家」をクリック (クラス: has-dot active またはテキスト「国家」)
  console.log("「国家」タブへ移動中...");
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, button, span'));
    const el = links.find(l => (l.innerText || l.textContent || '').trim() === '国家');
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 2. 「経済」をクリック (クラス: t-lbl またはテキスト「経済」)
  console.log("「経済」タブへ移動中...");
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('.t-lbl, span, a, button'));
    const el = elements.find(s => (s.innerText || s.textContent || '').trim() === '経済');
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 3. 「コインを送る」ボタン (#send) をクリック
  console.log("「コインを送る」ボタンをクリック中...");
  await page.waitForSelector('#send', { timeout: 10000 });
  await page.click('#send');
  await new Promise(r => setTimeout(r, 1500));

  // 4. モーダルに入力
  // #mf-h: ユーザーID (handle)
  console.log(`送金先ID (#mf-h) に入力: ${handle}`);
  await page.waitForSelector('#mf-h', { timeout: 10000 });
  await page.click('#mf-h');
  await page.type('#mf-h', handle, { delay: 40 });

  // #mf-a: 金額 (5コイン)
  console.log("金額 (#mf-a) に入力: 5");
  await page.waitForSelector('#mf-a', { timeout: 10000 });
  await page.click('#mf-a');
  await page.type('#mf-a', '5', { delay: 40 });

  // #mf-m: コメント
  console.log("コメント (#mf-m) に入力...");
  await page.waitForSelector('#mf-m', { timeout: 10000 });
  await page.click('#mf-m');
  await page.type('#mf-m', 'タイピング選手権 優勝賞金！おめでとうございます🏆', { delay: 40 });
  await new Promise(r => setTimeout(r, 1000));

  // 5. 「送る」確定ボタン (#modal-ok) をクリック
  console.log("送金確定ボタン (#modal-ok) をクリック...");
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  await page.click('#modal-ok');
  await new Promise(r => setTimeout(r, 3000));

  console.log(`🎉 @${handle} さんへの5コイン送金が完了しました！`);
  await page.screenshot({ path: 'coin-sent-result.png', fullPage: true }).catch(() => {});
}

// メイン実行関数
async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  console.log(`[BOT実行] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  if (jstMinutes > 10) {
    console.log(`⚠️ [ガード発動] 開始時刻が ${jstMinutes}分 と遅延しているため投稿をスキップします。`);
    return;
  }

  const isMorningBot = (jstHours === 4);
  const keyword = isMorningBot ? '' : getRandomKeyword();
  const message = createPostMessage(jstHours, keyword);

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("SNSへアクセス中...");
    await page.goto('https://national-sns.vercel.app', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // 1. ログイン入力
    await page.waitForSelector('#a-handle', { timeout: 15000 });
    await page.type('#a-handle', process.env.SNS_USER || '', { delay: 30 });

    await page.waitForSelector('#a-pass', { timeout: 10000 });
    await page.type('#a-pass', process.env.SNS_PASS || '', { delay: 30 });

    // ログインボタンクリック
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button, input.btn, .btn'));
      return btns.some(el => {
        const text = (el.innerText || el.value || '').trim();
        const cls = el.className || '';
        return text === 'ログイン' && cls.includes('btn') && !cls.includes('tab');
      });
    }, { timeout: 10000 });

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, input.btn, .btn'));
      for (const el of btns) {
        const text = (el.innerText || el.value || '').trim();
        const cls = el.className || '';
        if (text === 'ログイン' && cls.includes('btn') && !cls.includes('tab')) {
          el.click();
          return;
        }
      }
    });

    // 2. 画面遷移待機 & スキップボタン
    await page.waitForFunction(() => {
      const postBox = document.querySelector('#c-body');
      const skipBtn = Array.from(document.querySelectorAll('button')).find(
        b => (b.innerText || '').trim() === 'スキップ' && b.className.includes('ghost')
      );
      return !!postBox || !!skipBtn;
    }, { timeout: 20000 });

    const skipped = await page.evaluate(() => {
      const skipBtn = Array.from(document.querySelectorAll('button')).find(
        b => (b.innerText || '').trim() === 'スキップ' && b.className.includes('ghost')
      );
      if (skipBtn) {
        skipBtn.click();
        return true;
      }
      return false;
    });
    if (skipped) {
      console.log("スキップボタンをクリックしました。");
      await new Promise(r => setTimeout(r, 1500));
    }

    // 3. アナウンス投稿
    console.log("アナウンスメッセージ入力中...");
    await page.waitForSelector('#c-body', { timeout: 15000 });
    await page.type('#c-body', message, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    // 朝4時の場合は画像添付
    if (isMorningBot) {
      const imagePath = path.resolve('./george.jpg');
      if (fs.existsSync(imagePath)) {
        console.log(`朝4時: 画像添付中 (${imagePath})...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // 投稿ボタンを押下
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    await new Promise(r => setTimeout(r, 4000));
    console.log("アナウンス投稿完了！");

    // 4. タイピング選手権の監視処理（朝4時以外の場合）
    if (!isMorningBot) {
      console.log(`⏳ キーワード 『${keyword}』 の投稿を待機中（最大70秒）...`);
      const botHandle = (process.env.SNS_USER || '').replace(/^@/, '').trim();
      let winner = null;
      const startTime = Date.now();
      const waitTimeoutMs = 70 * 1000; // 70秒待機

      while (Date.now() - startTime < waitTimeoutMs) {
        await new Promise(r => setTimeout(r, 3500));

        // タイムラインをチェック
        winner = await page.evaluate((targetKeyword, myBotHandle) => {
          const bodyElements = Array.from(document.querySelectorAll('.post-body, div.post-body'));
          for (const bodyEl of bodyElements) {
            const bodyText = (bodyEl.innerText || bodyEl.textContent || '').trim();

            if (bodyText.includes(targetKeyword)) {
              const container = bodyEl.closest('.post, article, div') || bodyEl.parentElement;
              const handleEl = container ? container.querySelector('.post-handle, a.post-handle') : null;
              const nameEl = container ? container.querySelector('.post-name, a.post-name') : null;

              let handle = handleEl ? (handleEl.innerText || handleEl.textContent || '').trim() : '';
              const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';

              handle = handle.replace(/^@/, '').trim();

              // ボット自身の投稿を除外
              if (handle && handle !== myBotHandle && !bodyText.includes('【全国アナウンス（BOT）】')) {
                return { handle, name, text: bodyText };
              }
            }
          }
          return null;
        }, keyword, botHandle);

        if (winner) {
          console.log(`🏆 勝者を発見しました！ @${winner.handle} (${winner.name || 'ユーザー'}): "${winner.text}"`);
          break;
        }

        // ホーム画面を軽く更新
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const home = links.find(l => (l.innerText || '').trim() === 'ホーム');
          if (home) home.click();
        });
      }

      if (winner) {
        // 勝者に5コインを送金！
        await sendCoinsToWinner(page, winner.handle);

        // 結果発表をタイムラインに投稿！
        try {
          console.log("結果発表メッセージを投稿中...");
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });
          const resultMsg = `【結果発表】\nタイピング選手権、最速正解者は\n@${winner.handle} さんでした！🏆\n賞金5コインを送金しました！\n次回もお楽しみに！\n#全国アナウンスBOT`;
          await page.type('#c-body', resultMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          console.log("結果発表の投稿完了！");
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          console.warn("結果発表投稿で軽微なエラー:", e.message);
        }
      } else {
        console.log("⏱️ 制限時間内にキーワードの投稿はありませんでした。次回に持ち越し！");
      }
    }

    console.log("🎉 すべてのBOT処理が正常に完了しました！");
    await page.screenshot({ path: 'success-result.png', fullPage: true });

  } catch (error) {
    console.error(`❌ エラー発生 (試行 ${retryCount + 1}): `, error.message);
    await page.screenshot({ path: `error-debug-${retryCount + 1}.png`, fullPage: true }).catch(() => {});

    if (retryCount < maxRetries) {
      console.log(`🔄 5秒後にリトライします (${retryCount + 1}/${maxRetries})...`);
      await browser.close();
      await new Promise(r => setTimeout(r, 5000));
      return executeBotPost(retryCount + 1);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

// 実行開始
executeBotPost().catch(err => {
  console.error("致命的エラーで終了しました:", err);
  process.exit(1);
});
