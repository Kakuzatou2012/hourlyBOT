import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (v5.0 - 投稿番号#〇〇〇〇取得 ＆ キーワード部分一致 ＆ 5分後連番審査)
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

  // 遅延許容を5分までに設定
  const isForcePost = (process.env.FORCE_POST === 'true');
  const isDryRun = (jstMinutes > 5) && !isForcePost;

  // 毎日18時(午後6時)がタイピング大会開催時間 (手動FORCE_POST時も対象)
  const isEventHour = (jstHours === 18) || isForcePost;
  const isMorningBot = (jstHours === 4);

  console.log(`[BOT実行開始] JST時刻: ${jstHours}時${jstMinutes}分 (試行: ${retryCount + 1})`);

  if (isDryRun) {
    console.log("--------------------------------------------------");
    console.log("[安全テストモード (Dry Run)]");
    console.log(`現在は ${jstHours}時${jstMinutes}分 (5分を超過) のため、実際の確定ボタンは押さずに`);
    console.log("タイムライン解析 ＆ 全画面スクリーンショットを撮影して検証します。");
    console.log("--------------------------------------------------");
  } else {
    console.log(`[本番実行モード] 定時実行 (現在: ${jstMinutes}分 / 5分以内) として処理を開始します。`);
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

    // ========================================================
    // 【タイムライン描画待機 ＆ 投稿番号(#〇〇〇〇)つき直近投稿確認】
    // ========================================================
    console.log("==================================================");
    console.log("【タイムライン確認テスト】投稿の読み込み待機中...");

    try {
      await page.waitForSelector('article.post, .post, .post-body', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log("待機タイムアウト: スクロールして再試行中...");
      await page.evaluate(() => window.scrollBy(0, 300));
      await new Promise(r => setTimeout(r, 2000));
    }

    const debugStats = await page.evaluate(() => {
      const articles = document.querySelectorAll('article.post, .post').length;
      const bodies = document.querySelectorAll('.post-body').length;
      return { articles, bodies };
    });
    console.log(`[DOM状況] 発見した投稿要素: ${debugStats.articles}件 (本文: ${debugStats.bodies}件)`);

    const recentPosts = await page.evaluate(() => {
      const posts = [];
      const articles = Array.from(document.querySelectorAll('article.post, .post'));

      for (const art of articles) {
        if (posts.length >= 3) break;
        const nameEl = art.querySelector('.post-name');
        const handleEl = art.querySelector('.post-handle');
        const bodyEl = art.querySelector('.post-body');
        const idEl = art.querySelector('.post-id');

        const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
        const handle = handleEl ? (handleEl.innerText || handleEl.textContent || '').replace(/^@/, '').trim() : '';
        const comment = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
        const rawId = idEl ? idEl.innerText.replace('#', '').trim() : (art.dataset.id || '');
        const postId = rawId ? parseInt(rawId, 10) : null;

        if (comment) {
          posts.push({
            handle: handle || '（ハンドルなし）',
            name: name || '（表示名なし）',
            comment: comment,
            postId: postId
          });
        }
      }

      // フォールバック
      if (posts.length === 0) {
        const bodyEls = Array.from(document.querySelectorAll('.post-body, div.post-body'));
        for (const bodyEl of bodyEls) {
          if (posts.length >= 3) break;
          const container = bodyEl.closest('.post, article, div') || bodyEl.parentElement;
          const handleEl = container ? container.querySelector('.post-handle, a.post-handle') : null;
          const nameEl = container ? container.querySelector('.post-name, a.post-name') : null;
          const idEl = container ? container.querySelector('.post-id') : null;

          const handle = (handleEl ? (handleEl.innerText || handleEl.textContent || '') : '').replace(/^@/, '').trim();
          const name = (nameEl ? (nameEl.innerText || nameEl.textContent || '') : '').trim();
          const text = (bodyEl.innerText || bodyEl.textContent || '').trim();
          const rawId = idEl ? idEl.innerText.replace('#', '').trim() : '';

          if (text) {
            posts.push({
              handle: handle || '（ハンドルなし）',
              name: name || '（表示名なし）',
              comment: text,
              postId: rawId ? parseInt(rawId, 10) : null
            });
          }
        }
      }

      return posts;
    });

    if (recentPosts.length === 0) {
      console.log("⚠️ タイムライン上に投稿が見つかりませんでした (0件または非公開の可能性)。");
    } else {
      const latestId = recentPosts[0]?.postId;
      recentPosts.forEach((p, idx) => {
        const idLabel = p.postId ? ('#' + p.postId) : 'IDなし';
        const diffLabel = (latestId && p.postId && idx > 0) ? (' (最新#' + latestId + 'から -' + (latestId - p.postId) + ' 番目の投稿)') : '';
        console.log(`--------------------------------------------------`);
        console.log(`[直近投稿 第${idx + 1}位] 投稿番号: ${idLabel}${diffLabel}`);
        console.log(`  ユーザー名: @${p.handle}`);
        console.log(`  名前:       ${p.name}`);
        console.log(`  コメント:   "${p.comment}"`);
      });
      console.log(`--------------------------------------------------`);
      console.log(`合計 ${recentPosts.length} 件の直近ユーザー情報（投稿番号#つき）を正常に出力しました！`);
    }
    console.log("==================================================");

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

    // 【A. 安全テストモードの場合（遅延5分超過 または 手動テスト時）】
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

      const testRecipient = (recentPosts[0] && recentPosts[0].handle && recentPosts[0].handle !== '（ハンドルなし）')
        ? recentPosts[0].handle
        : (process.env.SNS_USER || 'sample_user');

      await page.waitForSelector('#mf-h', { timeout: 10000 });
      await page.type('#mf-h', testRecipient, { delay: 30 });

      await page.waitForSelector('#mf-a', { timeout: 10000 });
      await page.type('#mf-a', '25', { delay: 30 });

      await page.waitForSelector('#mf-m', { timeout: 10000 });
      await page.type('#mf-m', 'タイピング選手権 優勝賞金 (25コイン)', { delay: 30 });
      await new Promise(r => setTimeout(r, 1500));

      await page.screenshot({ path: '4-coin-modal-ready.png', fullPage: true });
      console.log(`[スクショ4保存] 4-coin-modal-ready.png (@${testRecipient} 宛て25コイン送金直前)`);

      console.log("==================================================");
      console.log("【テスト大成功】全画面の操作・直近ユーザー確認が正常完了しました！");
      console.log(`送金先テスト相手: @${testRecipient} (金額: 25コイン)`);
      console.log("--------------------------------------------------");
      console.log("[5分後に投稿される優勝者メッセージの見本]:");
      console.log(`【全国アナウンス（BOT）】\n本日のイベント優勝者は\n@${testRecipient} さんでした！\n\n制限時間5分の中で、最速での正解おめでとうございます！\n優勝賞金25コインを送金しました。\n明日もお楽しみに！\n#全国アナウンスBOT`);
      console.log("--------------------------------------------------");
      console.log("Actionsのログにて直近1〜3位の投稿内容と、Artifactsの4枚の画像を確認できます。");
      console.log("==================================================");
      return;
    }

    // 【B. 本番モードの場合（毎時0〜5分以内）】
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    await new Promise(r => setTimeout(r, 4000));
    console.log("アナウンス投稿完了！");

    // BOTのアナウンス投稿番号を取得（以降の投稿のみを審査対象とするため）
    await new Promise(r => setTimeout(r, 2000));
    const botPostId = await page.evaluate(() => {
      const firstArt = document.querySelector('article.post');
      if (firstArt) {
        const idEl = firstArt.querySelector('.post-id');
        const num = idEl ? idEl.innerText.replace('#', '').trim() : (firstArt.dataset.id || '');
        return parseInt(num, 10) || 0;
      }
      return 0;
    });
    console.log(`[基準BOT投稿番号] #${botPostId || '自動検出'}`);

    // 毎日18時のタイピング大会の場合：制限時間5分(300秒)で審査！
    if (isEventHour && keyword) {
      console.log("--------------------------------------------------");
      console.log(`[イベント開始] 制限時間: 5分間 (お題キーワード: 『${keyword}』)`);
      console.log(`※お題投稿(#${botPostId || '基準'})以降の投稿で、キーワードが含まれるコメントのみを審査します。`);
      console.log("--------------------------------------------------");

      const botHandle = (process.env.SNS_USER || '').replace(/^@/, '').trim();
      const startTime = Date.now();
      const competitionDurationMs = 5 * 60 * 1000;
      
      const qualifiedSubmissions = new Map();

      while (Date.now() - startTime < competitionDurationMs) {
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const remainingSec = Math.max(0, 300 - elapsedSec);

        const foundList = await page.evaluate((targetKeyword, myBotHandle, basePostId) => {
          const results = [];
          const articles = Array.from(document.querySelectorAll('article.post, .post'));

          // キーワード正規化（スペース・改行を除去した小文字）
          const normKey = targetKeyword.replace(/[\s\r\n\t]/g, '').toLowerCase();

          articles.forEach((art, index) => {
            const bodyEl = art.querySelector('.post-body');
            const bodyText = (bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '').trim();
            const normBody = bodyText.replace(/[\s\r\n\t]/g, '').toLowerCase();

            // 「その単語が入ってたらいい（部分一致）」の判定
            if (normBody.includes(normKey)) {
              const handleEl = art.querySelector('.post-handle');
              const nameEl = art.querySelector('.post-name');
              const idEl = art.querySelector('.post-id');

              let handle = handleEl ? (handleEl.innerText || handleEl.textContent || '') : '';
              const name = nameEl ? (nameEl.innerText || nameEl.textContent || '') : '';
              const rawId = idEl ? idEl.innerText.replace('#', '').trim() : (art.dataset.id || '');
              const postId = rawId ? parseInt(rawId, 10) : null;
              handle = handle.replace(/^@/, '').trim();

              // 判定条件:
              // 1. 自分のBOTではない
              // 2. BOT自身のアナウンスではない
              // 3. お題投稿番号より大きい（お題投稿後の新しいコメントであること）
              const isAfterBot = (!basePostId || !postId || postId > basePostId);

              if (handle && handle !== myBotHandle && !bodyText.includes('【全国アナウンス（BOT）】') && isAfterBot) {
                results.push({
                  handle,
                  name,
                  text: bodyText,
                  postId,
                  diff: (basePostId && postId) ? (postId - basePostId) : null,
                  index
                });
              }
            }
          });
          return results;
        }, keyword, botHandle, botPostId);

        for (const item of foundList) {
          if (!qualifiedSubmissions.has(item.handle)) {
            qualifiedSubmissions.set(item.handle, {
              ...item,
              discoveredAt: Date.now()
            });
            const diffMsg = item.diff ? (' (BOT投稿から +' + item.diff + ' 番目のコメント)') : '';
            console.log(`[正解検知！] @${item.handle} さん (#${item.postId || 'IDなし'}${diffMsg}): "${item.text}"`);
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
      console.log("5分の制限時間が終了しました！これより厳正審査を行います。");
      console.log(`総回答者数: ${qualifiedSubmissions.size} 名`);

      let winner = null;
      if (qualifiedSubmissions.size > 0) {
        // 投稿番号(postId)が最も小さい人（物理的に最速投稿した人）、または最も早く検知された人を1位とする
        const sorted = Array.from(qualifiedSubmissions.values()).sort((a, b) => {
          if (a.postId && b.postId) return a.postId - b.postId;
          return a.discoveredAt - b.discoveredAt;
        });
        winner = sorted[0];
        const winnerDiffMsg = winner.diff ? (' (BOT投稿から +' + winner.diff + ' 番目のコメント)') : '';
        console.log(`[審査結果: 1位確定] 最速正解者は @${winner.handle} さんです！(#${winner.postId || ''}${winnerDiffMsg})`);
      } else {
        console.log("[審査結果] 制限時間内に正解者の投稿はありませんでした。");
      }
      console.log("--------------------------------------------------");

      if (winner) {
        await sendCoinsToWinner(page, winner.handle, 25);

        try {
          console.log("優勝者発表メッセージを投稿中...");
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });

          const winnerDisplayName = winner.name ? (' (' + winner.name + ')') : '';
          const resultMsg = `【全国アナウンス（BOT）】\n本日のイベント優勝者は\n@${winner.handle} さん${winnerDisplayName}でした！\n\n制限時間5分の中で、最速での正解おめでとうございます！\n優勝賞金25コインを送金しました。\n明日もお楽しみに！\n#全国アナウンスBOT`;
          
          await page.type('#c-body', resultMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          console.log("優勝者発表メッセージの投稿完了！");
          console.log(resultMsg);
          await new Promise(r => setTimeout(r, 3000));
        } catch (e) {
          console.warn("優勝者発表投稿で軽微なエラー:", e.message);
        }
      } else {
        try {
          await page.goto('https://national-sns.vercel.app', { waitUntil: 'networkidle2' });
          await new Promise(r => setTimeout(r, 2000));
          await page.waitForSelector('#c-body', { timeout: 10000 });
          const noWinnerMsg = "【全国アナウンス（BOT）】\n本日のイベント結果発表\n制限時間5分の中で正解者の投稿はありませんでした。\nまた明日のご参加をお待ちしています！\n#全国アナウンスBOT";
          await page.type('#c-body', noWinnerMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          console.log("正解者なしメッセージの投稿完了！");
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
