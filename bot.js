import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (強化版 v3.5 - 安全テストモード＆スクショ完全対応)
 * 
 * 特徴:
 * 1. 時間外のテスト実行時でもスキップせず「送信直前まで操作を進めてスクショ保存」
 * 2. 毎時0〜10分以内の定時実行（または FORCE_POST=true）なら本番投稿＆送金
 * 3. 以下の4枚の検証スクショを必ずアーティファクトに保存:
 *    - 1-login-success.png (ログイン完了)
 *    - 2-post-before-submit.png (アナウンス入力完了・投稿直前)
 *    - 3-kokka-keizai.png (国家 > 経済 画面)
 *    - 4-coin-modal-ready.png (5コイン送金モーダル入力完了・送る直前)
 */

const KEYWORDS = [
  "ねこじゃらし", "マスカット", "ひまわり畑", "きつねうどん", "たいやき",
  "青空レストラン", "流星群", "メロンソーダ", "アイスコーヒー", "カスタードプリン",
  "かき氷いちご味", "オムライス", "ホットケーキ", "桜吹雪", "シュークリーム"
];

function getRandomKeyword() {
  return KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
}

function createPostMessage(hour, keyword) {
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に 何してるんだい？\n#全国アナウンスBOT";
  }
  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n\n【イベント】\nタイピング選手権\n次のワードを最速で投稿したユーザーには\n5コインを配布します！\nキーワード\n『${keyword}』\n#全国アナウンスBOT`;
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

// 本番用 送金処理
async function sendCoinsToWinner(page, handle) {
  console.log(`💰 @${handle} さんへ5コインを送金中...`);
  
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

  await page.waitForSelector('#mf-a', { timeout: 10000 });
  await page.type('#mf-a', '5', { delay: 40 });

  await page.waitForSelector('#mf-m', { timeout: 10000 });
  await page.type('#mf-m', 'タイピング選手権 優勝賞金！おめでとうございます🏆', { delay: 40 });
  await new Promise(r => setTimeout(r, 1000));

  // 5. 送る (#modal-ok)
  await page.waitForSelector('#modal-ok', { timeout: 10000 });
  await page.click('#modal-ok');
  await new Promise(r => setTimeout(r, 3000));
  console.log(`🎉 @${handle} さんへの5コイン送金が完了しました！`);
  await page.screenshot({ path: 'coin-sent-result.png', fullPage: true }).catch(() => {});
}

// メイン実行
async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const jstHours = jstDate.getHours();
  const jstMinutes = jstDate.getMinutes();

  // 判定: 毎時0〜10分以内、または手動強制フラグ(FORCE_POST)があれば本番実行
  const isForcePost = (process.env.FORCE_POST === 'true');
  const isDryRun = (jstMinutes > 10) && !isForcePost;

  console.log(`[BOT実行開始] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  if (isDryRun) {
    console.log("--------------------------------------------------");
    console.log("🧪 【安全テストモード (Dry Run)】が起動しました！");
    console.log(`現在は ${jstHours}時${jstMinutes}分 のため、実際の投稿・送金ボタンは押さずに`);
    console.log("「入力完了直前のスクリーンショット」を撮影して動作検証します。");
    console.log("--------------------------------------------------");
  } else {
    console.log("🚀 【本番実行モード】定時実行として実際に投稿・送金を行います。");
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
    console.log("1. SNSへアクセス中 (national-sns.vercel.app)...");
    await page.goto('https://national-sns.vercel.app', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // ログイン処理
    console.log("2. ログインフォームを入力中...");
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

    // 📸 スクショ 1: ログイン完了画面
    await page.screenshot({ path: '1-login-success.png', fullPage: true });
    console.log("📸 [スクショ1保存] 1-login-success.png (ログイン成功)");

    // 3. アナウンスメッセージ入力
    console.log("3. アナウンスメッセージを入力中...");
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

    // 📸 スクショ 2: 投稿ボタンを押す直前の状態！
    await page.screenshot({ path: '2-post-before-submit.png', fullPage: true });
    console.log("📸 [スクショ2保存] 2-post-before-submit.png (投稿メッセージ入力完了・送信直前)");

    // ========================================================
    // 【A. 安全テストモードの場合（時間外の実行）】
    // 実際の投稿は行わず、そのまま送金モーダルの入力直前テストへ進む
    // ========================================================
    if (isDryRun) {
      console.log("⚠️ [テスト中] 投稿ボタンは押さずに、「国家」>「経済」>「コイン送金」の直前テストへ進みます...");

      // 「国家」をクリック
      console.log("4. 「国家」タブへ移動中...");
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, span'));
        const el = links.find(l => (l.innerText || l.textContent || '').trim() === '国家');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      // 「経済」をクリック
      console.log("5. 「経済」タブへ移動中...");
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('.t-lbl, span, a, button'));
        const el = elements.find(s => (s.innerText || s.textContent || '').trim() === '経済');
        if (el) el.click();
      });
      await new Promise(r => setTimeout(r, 2000));

      // 📸 スクショ 3: 経済画面
      await page.screenshot({ path: '3-kokka-keizai.png', fullPage: true });
      console.log("📸 [スクショ3保存] 3-kokka-keizai.png (国家・経済画面表示完了)");

      // 「コインを送る」ボタン (#send)
      console.log("6. 「コインを送る」(#send) をクリック中...");
      await page.waitForSelector('#send', { timeout: 10000 });
      await page.click('#send');
      await new Promise(r => setTimeout(r, 1500));

      // モーダル枠へのテスト入力
      console.log("7. 送金モーダルの各枠に入力中...");
      // ユーザーID (#mf-h)
      await page.waitForSelector('#mf-h', { timeout: 10000 });
      await page.type('#mf-h', (process.env.SNS_USER || 'sample_user'), { delay: 30 });

      // 金額 (#mf-a)
      await page.waitForSelector('#mf-a', { timeout: 10000 });
      await page.type('#mf-a', '5', { delay: 30 });

      // コメント (#mf-m)
      await page.waitForSelector('#mf-m', { timeout: 10000 });
      await page.type('#mf-m', '【テスト実行】タイピング選手権 優勝賞金5コイン（送金直前スクショ確認用）', { delay: 30 });
      await new Promise(r => setTimeout(r, 1500));

      // 📸 スクショ 4: 送るボタンを押す直前の状態！
      await page.screenshot({ path: '4-coin-modal-ready.png', fullPage: true });
      console.log("📸 [スクショ4保存] 4-coin-modal-ready.png (送金情報入力完了・確定ボタン直前)");

      console.log("==================================================");
      console.log("🎉 【テスト大成功！】");
      console.log("・ログイン ➔ アナウンス入力 ➔ 国家 ➔ 経済 ➔ 送金モーダル入力");
      console.log("すべての画面操作と入力が正常に完了したことを確認しました！");
      console.log("※テストモードのため確定ボタンは押さずに安全終了しました。");
      console.log("GitHub Actions の Artifacts (bot-screenshots) をダウンロードして4枚の画像をご確認ください。");
      console.log("==================================================");
      return;
    }

    // ========================================================
    // 【B. 本番モードの場合（毎時0〜10分以内 または FORCE_POST=true）】
    // 実際に投稿を行い、タイピング回答者を監視して5コインを送金する
    // ========================================================
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    await new Promise(r => setTimeout(r, 4000));
    console.log("アナウンス投稿完了！");

    if (!isMorningBot) {
      console.log(`⏳ キーワード 『${keyword}』 の投稿を待機中（最大70秒）...`);
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
          console.log(`🏆 勝者を発見しました！ @${winner.handle}: "${winner.text}"`);
          break;
        }

        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a, button'));
          const home = links.find(l => (l.innerText || '').trim() === 'ホーム');
          if (home) home.click();
        });
      }

      if (winner) {
        await sendCoinsToWinner(page, winner.handle);

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
        console.log("⏱️ 制限時間内にキーワードの投稿はありませんでした。");
      }
    }

    console.log("🎉 すべての処理が正常に完了しました！");
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

executeBotPost().catch(err => {
  console.error("致命的エラーで終了しました:", err);
  process.exit(1);
});
