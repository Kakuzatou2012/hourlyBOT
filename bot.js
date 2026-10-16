import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (v4.0 - 5分間審査システム ＆ 毎日18時25コイン対応)
 */

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

// 投稿メッセージ生成 (絵文字なし)
function createPostMessage(hour, keyword) {
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはようございます。\n朝4時になりました。\n#全国アナウンスBOT";
  }
  if (hour === 18) {
    return `【全国アナウンス（BOT）】\n18時になりました。\n\n【イベント】\nデイリータイピング選手権（制限時間5分）\n次のワードを最速で投稿したユーザーに\n25コインを配布します！\n\nお題キーワード\n『${keyword}』\n#全国アナウンスBOT`;
  }
  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n#全国アナウンスBOT`;
}

// 投稿ボタンクリック処理
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

// コイン送金処理 (国家 > 経済 > コインを送る)
async function sendCoinsToWinner(page, handle, amount = 25) {
  console.log(`[@${handle}] さんへ ${amount} コインを送金中...`);
  
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

  // 4. 入力 (ユーザーID, 金額, コメント)
  await page.waitForSelector('#mf-h', { timeout: 10000 });
  await page.type('#mf-h', handle, { delay: 40 });

  await page.waitForSelector('#mf-a', { timeout: 10000 });
  await page.type('#mf-a', String(amount), { delay: 40 });

  await page.waitForSelector('#mf-m', { timeout: 10000 });
  await page.type('#mf-m', `タイピング選手権 優勝賞金 (${amount}コイン)`, { delay: 40 });
  await new Promise(r => setTimeout(r, 1000));

  // 5. 送る (#modal-ok)
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  await page.click('#modal-ok');
  await new Promise(r => setTimeout(r, 3000));
  console.log(`[@${handle}] さんへの ${amount} コイン送金が完了しました。`);
  await page.screenshot({ path: 'coin-sent-result.png', fullPage: true }).catch(() => {});
}

// メイン実行
async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  const isForcePost = (process.env.FORCE_POST === 'true');
  const isDryRun = (jstMinutes > 10) && !isForcePost;

  // 毎日18時(午後6時)がタイピング大会開催時間 (手動FORCE_POST時も対象)
  const isEventHour = (jstHours === 18) || isForcePost;
  const isMorningBot = (jstHours === 4);

  console.log(`[BOT実行開始] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  if (isDryRun) {
    console.log("--------------------------------------------------");
    console.log("[安全テストモード (Dry Run)]");
    console.log(`現在は ${jstHours}時${jstMinutes}分 のため、実際の確定ボタンは押さずに`);
    console.log("入力完了直前の全画面スクリーンショットを撮影して検証します。");
    console.log("--------------------------------------------------");
  } else {
    console.log("[本番実行モード] 定時実行として投稿処理を開始します。");
    if (isEventHour) {
      console.log("★ 毎日18時: タイピング選手権 (賞金25コイン / 制限時間5分審査) が開催されます！");
    }
  }

  const keyword = isEventHour ? getRandomKeyword() : '';
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

    // ログイン処理
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

    // ログイン後の待機 & スキップボタン
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

    // スクショ1: ログイン成功
    await page.screenshot({ path: '1-login-success.png', fullPage: true });
    console.log("[スクショ1保存] 1-login-success.png");

    // 3. アナウンスメッセージ入力
    console.log("3. メッセージを入力中...");
    await page.waitForSelector('#c-body', { timeout: 15000 });
    await page.type('#c-body', message, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    // 朝4時の画像添付
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

    // スクショ2: 投稿直前
    await page.screenshot({ path: '2-post-before-submit.png', fullPage: true });
    console.log("[スクショ2保存] 2-post-before-submit.png (投稿直前)");

    // 【A. 安全テストモードの場合】
    if (isDryRun) {
      console.log("[テスト中] 投稿ボタンは押さずに送金画面の検証へ進みます...");

      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, span'));
        const el = links.find(l => (l.innerText || l.textContent || '').trim() === '国家');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('.t-lbl, span, a, button'));
        const el = elements.find(s => (s.innerText || s.textContent || '').trim() === '経済');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      await page.screenshot({ path: '3-kokka-keizai.png', fullPage: true });
      console.log("[スクショ3保存] 3-kokka-keizai.png");

      await page.waitForSelector('#send', { timeout: 10000 });
      await page.click('#send');
      await new Promise(r => setTimeout(r, 1500));

      await page.waitForSelector('#mf-h', { timeout: 10000 });
      await page.type('#mf-h', (process.env.SNS_USER || 'sample_user'), { delay: 30 });

      await page.waitForSelector('#mf-a', { timeout: 10000 });
      await page.type('#mf-a', '25', { delay: 30 }); // 25コイン

      await page.waitForSelector('#mf-m', { timeout: 10000 });
      await page.type('#mf-m', 'タイピング選手権 優勝賞金 (25コイン)', { delay: 30 });
      await new Promise(r => setTimeout(r, 1500));

      await page.screenshot({ path: '4-coin-modal-ready.png', fullPage: true });
      console.log("[スクショ4保存] 4-coin-modal-ready.png (送金直前)");

      console.log("==================================================");
      console.log("【テスト大成功】全画面の操作・入力が正常完了しました！");
      console.log("送金金額は 25コイン に設定されています。");
      console.log("Actionsの Artifacts (bot-screenshots) から4枚の画像を確認できます。");
      console.log("==================================================");
      return;
    }

    // 【B. 本番モードの場合】
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    await new Promise(r => setTimeout(r, 4000));
    console.log("アナウンス投稿完了！");

    // 毎日18時のタイピング大会の場合：制限時間5分(300秒)で審査
    if (isEventHour && keyword) {
      console.log("--------------------------------------------------");
      console.log(`[イベント開始] 制限時間: 5分間 (お題: 『${keyword}』)`);
      console.log("5分間かけてタイムラインの回答を記録し、終了後に最速1位を厳正審査します...");
      console.log("--------------------------------------------------");

      const botHandle = (process.env.SNS_USER || '').replace(/^@/, '').trim();
      const startTime = Date.now();
      const competitionDurationMs = 5 * 60 * 1000; // 5分間 (300,000ms)
      
      const qualifiedSubmissions = new Map();

      while (Date.now() - startTime < competitionDurationMs) {
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const remainingSec = Math.max(0, 300 - elapsedSec);

        const foundList = await page.evaluate((targetKeyword, myBotHandle) => {
          const results = [];
          const bodyElements = Array.from(document.querySelectorAll('.post-body, div.post-body'));

          bodyElements.forEach((bodyEl, index) => {
            const bodyText = (bodyEl.innerText || bodyEl.textContent || '').trim();

            if (bodyText.includes(targetKeyword)) {
              const container = bodyEl.closest('.post, article, div') || bodyEl.parentElement;
              const handleEl = container ? container.querySelector('.post-handle, a.post-handle') : null;
              const nameEl = container ? container.querySelector('.post-name, a.post-name') : null;

              let handle = handleEl ? (handleEl.innerText || handleEl.textContent || '').trim() : '';
              const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
              handle = handle.replace(/^@/, '').trim();

              if (handle && handle !== myBotHandle && !bodyText.includes('【全国アナウンス（BOT）】')) {
                results.push({ handle, name, text: bodyText, index });
              }
            }
          });
          return results;
        }, keyword, botHandle);

        for (const item of foundList) {
          if (!qualifiedSubmissions.has(item.handle)) {
            qualifiedSubmissions.set(item.handle, {
              ...item,
              discoveredAt: Date.now()
            });
            console.log(`[回答検知] @${item.handle} さんがキーワードを投稿しました (経過: ${elapsedSec}秒)`);
          }
        }

        if (elapsedSec % 30 < 15) {
          console.log(`[審査中] 残り時間: ${Math.floor(remainingSec / 60)}分${remainingSec % 60}秒 (現在 ${qualifiedSubmissions.size} 人の正解を検知)`);
        }

        await new Promise(r => setTimeout(r, 15000));

        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const home = links.find(l => (l.innerText || '').trim() === 'ホーム');
          if (home) home.click();
        });
      }

      console.log("--------------------------------------------------");
      console.log("5分の制限時間が終了しました！これより審査を行います。");
      console.log(`総回答者数: ${qualifiedSubmissions.size} 名`);

      let winner = null;
      if (qualifiedSubmissions.size > 0) {
        const sorted = Array.from(qualifiedSubmissions.values()).sort((a, b) => a.discoveredAt - b.discoveredAt);
        winner = sorted[0];
        console.log(`[審査結果: 1位確定] 最速正解者は @${winner.handle} さんです！`);
      } else {
        console.log("[審査結果] 制限時間内に正解者の投稿はありませんでした。");
      }
      console.log("--------------------------------------------------");

      if (winner) {
        await sendCoinsToWinner(page, winner.handle, 25);

        try {
          console.log("結果発表メッセージを投稿中...");
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });

          const resultMsg = `【結果発表】\nデイリータイピング選手権の審査が完了しました。\n制限時間5分の中で、最速正解者は\n@${winner.handle} さんでした！\n\n優勝賞金25コインを送金しました。\nご参加ありがとうございました！\n#全国アナウンスBOT`;
          await page.type('#c-body', resultMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          console.log("結果発表の投稿完了！");
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          console.warn("結果発表投稿で軽微なエラー:", e.message);
        }
      } else {
        try {
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });
          const noWinnerMsg = "【結果発表】\nデイリータイピング選手権（制限時間5分）\n今回は正解者の投稿がありませんでした。\nまた次回のご参加をお待ちしています！\n#全国アナウンスBOT";
          await page.type('#c-body', noWinnerMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
        } catch (e) {}
      }
    }

    console.log("すべての処理が正常に完了しました！");
    await page.screenshot({ path: 'success-result.png', fullPage: true }).catch(() => {});

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
