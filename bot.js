import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT
 * - 毎日18時(午後6時)限定: タイピング選手権 ＆ 25コイン自動送金
 * - 朝4時限定: 画像付きおはようアナウンス (george.jpg)
 * - その他の時間: 通常の時報アナウンス (コイン消費なし)
 * - 絵文字なし
 */

// タイピング選手権のお題（指定12単語）
const KEYWORDS = [
  "新幹線",
  "自動販売機",
  "スマートフォン",
  "洗濯機",
  "横断歩道",
  "携帯電話",
  "アイスクリーム",
  "東京タワー",
  "消しゴム",
  "電子レンジ",
  "東京スカイツリー",
  "ファミリーレストラン"
];

function getRandomKeyword() {
  return KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
}

// 投稿メッセージ生成
function createPostMessage(hour, keyword) {
  // 朝4時
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に 何してるんだい？\n#全国アナウンスBOT";
  }

  // 毎日午後6時 (18時) 限定イベント
  if (hour === 18) {
    return `【全国アナウンス（BOT）】\n18時になりました。\n\n【イベント】\nタイピング選手権\n次のワードを最速で投稿したユーザーには\n25コインを配布します！\nキーワード\n『${keyword}』\n#全国アナウンスBOT`;
  }

  // その他の通常時報 (コイン消費なし)
  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n#全国アナウンスBOT`;
}

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

// 25コイン送金処理
async function sendCoinsToWinner(page, handle) {
  console.log(`@${handle} さんへ25コインを送金中...`);
  
  // 1. 国家
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a, button, span'));
    const el = links.find(l => (l.innerText || l.textContent || '').trim() === '国家');
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 2. 経済
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('.t-lbl, span, a, button'));
    const el = elements.find(s => (s.innerText || s.textContent || '').trim() === '経済');
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 3. コインを送る (#send)
  await page.waitForSelector('#send', { timeout: 10000 });
  await page.click('#send');
  await new Promise(r => setTimeout(r, 1500));

  // 4. 入力
  await page.waitForSelector('#mf-h', { timeout: 10000 });
  await page.type('#mf-h', handle, { delay: 40 });

  // 金額: 25コイン
  await page.waitForSelector('#mf-a', { timeout: 10000 });
  await page.type('#mf-a', '25', { delay: 40 });

  // 送金メモ (絵文字なし)
  await page.waitForSelector('#mf-m', { timeout: 10000 });
  await page.type('#mf-m', 'タイピング選手権 優勝賞金 (25コイン)', { delay: 40 });
  await new Promise(r => setTimeout(r, 1000));

  // 5. 送る (#modal-ok)
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  await page.click('#modal-ok');
  await new Promise(r => setTimeout(r, 3000));
  console.log(`@${handle} さんへの25コイン送金が完了しました。`);
  await page.screenshot({ path: 'coin-sent-result.png', fullPage: true }).catch(() => {});
}

async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  const isForcePost = (process.env.FORCE_POST === 'true');
  const isDryRun = (jstMinutes > 10) && !isForcePost;

  // 判定: 午後6時 (18時) のみタイピングイベントを開催
  const isTypingEvent = (jstHours === 18);
  const isMorningBot = (jstHours === 4);

  console.log(`[BOT実行開始] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  if (isDryRun) {
    console.log("--------------------------------------------------");
    console.log("【安全テストモード】が起動しました");
    console.log(`現在は ${jstHours}時${jstMinutes}分 のため、送信直前まで進めてスクショを撮影します。`);
    console.log("--------------------------------------------------");
  } else {
    console.log(`【本番実行モード】${isTypingEvent ? '18時タイピング選手権（賞金25コイン）' : '通常時報'}を投稿します。`);
  }

  const keyword = isTypingEvent ? getRandomKeyword() : '';
  const message = createPostMessage(jstHours, keyword);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("1. SNSへアクセス中...");
    await page.goto('https://national-sns.vercel.app', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // ログイン入力
    console.log("2. ログイン情報を入力中...");
    await page.waitForSelector('#a-handle', { timeout: 15000 });
    await page.type('#a-handle', process.env.SNS_USER || '', { delay: 30 });

    await page.waitForSelector('#a-pass', { timeout: 10000 });
    await page.type('#a-pass', process.env.SNS_PASS || '', { delay: 30 });

    // ログインボタン
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

    // ログイン後待機 & スキップボタン
    await page.waitForFunction(() => {
      const postBox = document.querySelector('#c-body');
      const skipBtn = Array.from(document.querySelectorAll('button, a')).find(
        b => (b.innerText || b.textContent || '').trim().includes('スキップ')
      );
      return !!postBox || !!skipBtn;
    }, { timeout: 20000 });

    const skipped = await page.evaluate(() => {
      const skipBtn = Array.from(document.querySelectorAll('button, a')).find(
        b => (b.innerText || b.textContent || '').trim().includes('スキップ')
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

    // スクショ 1: ログイン完了
    await page.screenshot({ path: '1-login-success.png', fullPage: true });

    // アナウンスメッセージ入力
    console.log("3. メッセージを入力中...");
    await page.waitForSelector('#c-body', { timeout: 15000 });
    await page.type('#c-body', message, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    // 朝4時の画像添付チェック
    if (isMorningBot) {
      const imagePath = path.resolve('./george.jpg');
      if (fs.existsSync(imagePath)) {
        console.log(`朝4時画像添付中 (${imagePath})...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // スクショ 2: 投稿ボタンを押す直前
    await page.screenshot({ path: '2-post-before-submit.png', fullPage: true });

    // 【テストモード（時間外）の場合】
    if (isDryRun) {
      console.log("[テスト中] 投稿ボタンは押さずに送金画面の検証へ進みます...");

      // 国家
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, span'));
        const el = links.find(l => (l.innerText || l.textContent || '').trim() === '国家');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      // 経済
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('.t-lbl, span, a, button'));
        const el = elements.find(s => (s.innerText || s.textContent || '').trim() === '経済');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      // スクショ 3: 経済画面
      await page.screenshot({ path: '3-kokka-keizai.png', fullPage: true });

      // コインを送る (#send)
      await page.waitForSelector('#send', { timeout: 10000 });
      await page.click('#send');
      await new Promise(r => setTimeout(r, 1500));

      // 送金モーダルへのテスト入力 (25コイン)
      await page.waitForSelector('#mf-h', { timeout: 10000 });
      await page.type('#mf-h', (process.env.SNS_USER || 'sample_user'), { delay: 30 });

      await page.waitForSelector('#mf-a', { timeout: 10000 });
      await page.type('#mf-a', '25', { delay: 30 });

      await page.waitForSelector('#mf-m', { timeout: 10000 });
      await page.type('#mf-m', 'タイピング選手権 優勝賞金25コイン(テスト)', { delay: 30 });
      await new Promise(r => setTimeout(r, 1500));

      // スクショ 4: 送るボタンを押す直前
      await page.screenshot({ path: '4-coin-modal-ready.png', fullPage: true });

      console.log("==================================================");
      console.log("全画面の操作・入力が正常完了しました。");
      console.log("※テストモードのため確定ボタンは押さずに安全終了しました。");
      console.log("==================================================");
      return;
    }

    // 【本番モードの場合】
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    await new Promise(r => setTimeout(r, 4000));
    console.log("アナウンス投稿完了");

    // 18時のみタイピング選手権の回答者を監視
    if (isTypingEvent) {
      console.log(`キーワード 『${keyword}』 の投稿を待機中（最大70秒）...`);
      const botHandle = (process.env.SNS_USER || '').replace(/^@/, '').trim();
      let winner = null;
      const startTime = Date.now();
      const waitTimeoutMs = 70 * 1000;

      while (Date.now() - startTime < waitTimeoutMs) {
        await new Promise(r => setTimeout(r, 3500));

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

              if (handle && handle !== myBotHandle && !bodyText.includes('【全国アナウンス（BOT）】')) {
                return { handle, name, text: bodyText };
              }
            }
          }
          return null;
        }, keyword, botHandle);

        if (winner) {
          console.log(`勝者を発見しました: @${winner.handle}: "${winner.text}"`);
          break;
        }

        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const home = links.find(l => (l.innerText || '').trim() === 'ホーム');
          if (home) home.click();
        });
      }

      if (winner) {
        // 勝者に25コインを送金
        await sendCoinsToWinner(page, winner.handle);

        try {
          console.log("結果発表メッセージを投稿中...");
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });
          // 結果発表メッセージ
          const resultMsg = `【結果発表】\nタイピング選手権、最速正解者は\n@${winner.handle} さんでした！\n賞金25コインを送金しました！\n次回もお楽しみに！\n#全国アナウンスBOT`;
          await page.type('#c-body', resultMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          console.log("結果発表の投稿完了");
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          console.warn("結果発表投稿で軽微なエラー:", e.message);
        }
      } else {
        console.log("制限時間内にキーワードの投稿はありませんでした。");
      }
    }

    console.log("すべての処理が正常に完了しました。");
    await page.screenshot({ path: 'success-result.png', fullPage: true });

  } catch (error) {
    console.error(`エラー発生 (試行 ${retryCount + 1}): `, error.message);
    await page.screenshot({ path: `error-debug-${retryCount + 1}.png`, fullPage: true }).catch(() => {});

    if (retryCount < maxRetries) {
      console.log(`5秒後にリトライします (${retryCount + 1}/${maxRetries})...`);
      await browser.close();
      await new Promise(r => setTimeout(r, 5000));
      return executeBotPost(retryCount + 1);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

executeBotPost().catch(err => {
  console.error("致命的エラーで終了しました:", err);
  process.exit(1);
});
