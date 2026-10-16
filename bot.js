import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (v5.0)
 * 
 * ・手動（主導）実行時: 「何時になりました」を除外し【不定期型イベント開催】として即時開始
 * ・定期実行時（18時）: 毎日18時の定時タイピング選手権
 * ・ログイン判定: 未ログイン状態を厳密判定して確実に認証完了を待機
 * ・注目投稿除外: 「✨ 注目」ピン留め投稿を省いて最新の投稿のみを審査
 * ・送金 ＆ 結果発表: 5分間の制限時間審査後、最速正解者へ25コイン送金と結果投稿
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

// 投稿メッセージ生成 (手動開催時は「何時になりました」を含めない)
function createPostMessage(hour, keyword, isManualEvent, coins) {
  // 手動（主導）実行時は「何時になりました」は含めず、不定期型イベントとして投稿
  if (isManualEvent) {
    return `【全国アナウンス（BOT）】\n【不定期型イベント開催】\nタイピング選手権（制限時間5分）\n次のワードを最速で投稿したユーザーに\n${coins}コインを配布します！\n\nお題キーワード\n『${keyword}』\n#全国アナウンスBOT`;
  }
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはようございます。\n朝4時になりました。\n#全国アナウンスBOT";
  }
  if (hour === 18) {
    return `【全国アナウンス（BOT）】\n18時になりました。\n\n【イベント】\nデイリータイピング選手権（制限時間5分）\n次のワードを最速で投稿したユーザーに\n${coins}コインを配布します！\n\nお題キーワード\n『${keyword}』\n#全国アナウンスBOT`;
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

async function executeBotPost(retryCount = 0) {
  const maxRetries = 2;
  let browser = null;
  let page = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // JST日時の算出
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstDate = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    const jstHour = jstDate.getHours();
    const jstMinutes = jstDate.getMinutes();

    // 実行引数・環境変数の読み込み
    const args = process.argv.slice(2);
    const rawMode = (process.env.MODE || process.env.INPUT_MODE || '').trim().toLowerCase();
    const isGitHubManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

    // 手動（主導）実行の判定:
    // ・GitHub Actionsの手動実行 (workflow_dispatch)
    // ・引数やMODEに manual, event, event_now が指定された場合
    // ※手動実行時は「何時になりました」は出さず、不定期型イベントとして即時開催！
    const isManualEvent = 
      isGitHubManual ||
      args.includes('--manual') ||
      args.includes('--event-now') ||
      args.includes('event') ||
      rawMode === 'event_now' ||
      rawMode === 'manual' ||
      process.env.EVENT_NOW === 'true' ||
      process.env.MANUAL === 'true';

    const isForcePost = args.includes('--force') || rawMode === 'force_post' || process.env.FORCE_POST === 'true';
    const isExplicitDryRun = rawMode === 'dry_run' || process.env.DRY_RUN === 'true';

    // カスタムお題と賞金
    const customKeyword = (process.env.CUSTOM_KEYWORD || '').trim();
    const eventCoins = parseInt(process.env.CUSTOM_COINS || '25', 10) || 25;

    // イベント判定: 手動不定期イベント または 毎日18時の定期イベント
    const isScheduledEvent = (jstHour === 18) && !isManualEvent;
    const isEventHour = isManualEvent || isScheduledEvent;
    const isMorningBot = (jstHour === 4) && !isManualEvent;

    const keyword = isEventHour ? (customKeyword || getRandomKeyword()) : null;
    const message = createPostMessage(jstHour, keyword, isManualEvent, eventCoins);

    // 安全テストモード(Dry-Run)判定:
    // ・手動不定期イベント(isManualEvent) または 強制投稿(isForcePost) が指定されている場合は【時間外でも本番投稿を実行】
    // ・手動で dry_run が明示された場合、または (定期実行時で5分を超過している場合) に Dry-Run と判定
    const isDryRun = isExplicitDryRun || (!isManualEvent && !isForcePost && jstMinutes > 5);

    console.log("==================================================");
    console.log(`[BOT実行開始] JST時刻: ${jstHour}時${jstMinutes}分 (試行: ${retryCount + 1})`);
    if (isManualEvent) {
      console.log("★【不定期型イベント手動開催モード】");
      console.log(`   「何時になりました」を除外し、不定期型イベントとして即時開催します (賞金: ${eventCoins}コイン / お題: 『${keyword}』)`);
    } else if (isDryRun) {
      console.log("--------------------------------------------------");
      console.log("[安全テストモード (Dry Run)]");
      console.log(`現在は ${jstHour}時${jstMinutes}分 (5分を超過) のため、実際の確定ボタンは押さずに`);
      console.log("タイムライン解析 ＆ 全画面スクリーンショットを撮影して検証します。");
      console.log("--------------------------------------------------");
    } else {
      console.log(`[本番実行モード] 定時自動実行 (現在: ${jstMinutes}分 / 5分以内) として処理を開始します。`);
      if (isEventHour) {
        console.log(`★ 毎日18時: 定期タイピング選手権 (賞金${eventCoins}コイン / 制限時間5分審査) が開催されます！`);
      }
    }
    console.log("==================================================");

    // 1. サイトアクセス
    console.log("1. SNSへアクセス中...");
    await page.goto("https://national-sns.vercel.app/", { waitUntil: "networkidle2", timeout: 45000 });

    // 2. ログイン状態確認・ログイン処理
    console.log("2. ログイン状態を確認中...");

    // ログイン入力欄(#a-handle) または タイムライン投稿欄(#c-body)の描画を待機
    await page.waitForFunction(() => {
      return !!document.querySelector('#a-handle') || !!document.querySelector('#c-body');
    }, { timeout: 35000 });

    // 投稿入力欄(#c-body)がまだ無ければ、必ずログインを実行
    const needLogin = await page.evaluate(() => {
      const hasComposer = !!document.querySelector('#c-body');
      const hasLoginForm = !!document.querySelector('#a-handle');
      return !hasComposer || hasLoginForm;
    });

    if (needLogin) {
      console.log("未ログイン状態です。ログイン処理を開始します...");

      const rawUser = process.env.SNS_USER || '';
      const rawPass = process.env.SNS_PASS || '';
      const cleanUser = rawUser.replace(/^@/, '').trim();
      const cleanPass = rawPass.replace(/[\r\n]+$/, '');

      if (!cleanUser || !cleanPass) {
        throw new Error("環境変数 SNS_USER または SNS_PASS が空です。GitHub Secretsを確認してください。");
      }

      // 「ログイン」タブを選択（新規登録タブになっている場合の安全策）
      await page.evaluate(() => {
        const loginTab = document.querySelector('button[data-mode="login"]');
        if (loginTab && !loginTab.classList.contains('active')) {
          loginTab.click();
        }
      });

      // ユーザー名入力欄の待機・クリア・入力
      console.log(`アカウント (@${cleanUser}) の認証情報を入力中...`);
      await page.waitForSelector('#a-handle', { timeout: 15000 });
      await page.click('#a-handle', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#a-handle', cleanUser, { delay: 35 });

      // パスワード入力欄の待機・クリア・入力
      await page.waitForSelector('#a-pass', { timeout: 15000 });
      await page.click('#a-pass', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#a-pass', cleanPass, { delay: 35 });

      // 万一の入力抜けを防ぐDOM補強
      await page.evaluate((u, p) => {
        const h = document.querySelector('#a-handle');
        const pwd = document.querySelector('#a-pass');
        if (h && (!h.value || h.value.trim() !== u)) {
          h.value = u;
          h.dispatchEvent(new Event('input', { bubbles: true }));
          h.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (pwd && (!pwd.value || pwd.value !== p)) {
          pwd.value = p;
          pwd.dispatchEvent(new Event('input', { bubbles: true }));
          pwd.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, cleanUser, cleanPass);

      // ログイン送信ボタンを押下
      console.log("ログインボタンを押下中...");
      await page.evaluate(() => {
        const btn = document.querySelector('#auth-form button[type="submit"]') || document.querySelector('#auth-form .btn');
        if (btn) {
          btn.click();
        } else {
          const form = document.querySelector('#auth-form');
          if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      });

      // 認証完了（投稿欄 #c-body が出現するか、またはエラー表示 #a-err に文字が入るか）を待機
      console.log("認証完了を待機中 (Supabaseレスポンス)...");
      await page.waitForFunction(() => {
        const composer = !!document.querySelector('#c-body');
        const errEl = document.querySelector('#a-err');
        const hasErr = errEl && (errEl.textContent || '').trim().length > 0;
        return composer || hasErr;
      }, { timeout: 35000 });

      // エラーメッセージの有無を確認
      const authError = await page.evaluate(() => {
        const errEl = document.querySelector('#a-err');
        return errEl ? (errEl.textContent || '').trim() : '';
      });

      if (authError) {
        throw new Error(`ログインエラー（サイト返答: "${authError}"）- Secretsの SNS_USER / SNS_PASS をご確認ください`);
      }

      // タイムライン投稿欄の描画を確実に待機
      await page.waitForSelector('#c-body', { timeout: 15000 });
      console.log(`✓ アカウント (@${cleanUser}) でログインに成功しました！`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log("✓ 既にログイン済み（セッション有効）です。ログイン処理をスキップします。");
    }

    // ログイン後ダイアログ等のスキップ
    const skipBtn = await page.$('.btn-skip, button.skip, #btn-skip');
    if (skipBtn) {
      await skipBtn.click().catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }

    // スクショ1: ログイン成功
    await page.screenshot({ path: '1-login-success.png', fullPage: true });
    console.log("[スクショ1保存] 1-login-success.png");

    // ========================================================
    // 【タイムライン確認】「✨ 注目」を除外して直近1〜3件を出力
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

    // 「✨ 注目」機能のピン留め投稿を厳密に除外して最新3件を抽出
    const recentPosts = await page.evaluate(() => {
      const posts = [];
      const articles = Array.from(document.querySelectorAll('article.post, .post'));

      for (const art of articles) {
        if (posts.length >= 3) break;

        // 【除外条件】「✨ 注目」ピン留め・目立たせる機能の投稿は除外
        const isFeatured = 
          art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
          art.querySelector('.hl-tag') !== null ||
          (art.innerHTML && art.innerHTML.includes('hl-tag')) ||
          (art.className && art.className.includes('pinned'));

        if (isFeatured) {
          continue;
        }

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

      return posts;
    });

    if (recentPosts.length === 0) {
      console.log("⚠️ タイムライン上に通常投稿が見つかりませんでした。");
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
      console.log(`合計 ${recentPosts.length} 件の通常投稿（✨注目投稿を除外）を正常に出力しました！`);
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

    // ========================================================
    // 【A. 安全テストモードの場合（遅延5分超過 または 手動dry_run時）】
    // ========================================================
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
      await page.type('#mf-a', String(eventCoins), { delay: 30 });

      await page.waitForSelector('#mf-m', { timeout: 10000 });
      await page.type('#mf-m', `タイピング選手権 優勝賞金 (${eventCoins}コイン)`, { delay: 30 });
      await new Promise(r => setTimeout(r, 1500));

      await page.screenshot({ path: '4-coin-modal-ready.png', fullPage: true });
      console.log(`[スクショ4保存] 4-coin-modal-ready.png (@${testRecipient} 宛て${eventCoins}コイン送金直前)`);

      console.log("==================================================");
      console.log("【テスト大成功】全画面の操作・直近ユーザー確認が正常完了しました！");
      console.log(`送金先テスト相手: @${testRecipient} (金額: ${eventCoins}コイン)`);
      console.log("--------------------------------------------------");
      console.log("[5分後に投稿される優勝者メッセージの見本]:");
      const sampleWinnerTitle = isManualEvent ? "【不定期型イベント結果発表】\n優勝者は" : "本日のイベント優勝者は";
      console.log(`【全国アナウンス（BOT）】\n${sampleWinnerTitle}\n@${testRecipient} さんでした！\n\n制限時間5分の中で、最速での正解おめでとうございます！\n優勝賞金${eventCoins}コインを送金しました。\n次回のイベントもお楽しみに！\n#全国アナウンスBOT`);
      console.log("--------------------------------------------------");
      console.log("Actionsのログにて直近1〜3位の投稿内容と、Artifactsの4枚の画像を確認できます。");
      console.log("==================================================");
      return;
    }

    // ========================================================
    // 【B. 本番モードの場合（手動不定期イベント または 毎時0〜5分以内）】
    // ========================================================
    console.log("アナウンスを投稿します...");
    await clickPostButton(page);
    console.log("アナウンス投稿完了！タイムラインの反映を待機中...");
    await new Promise(r => setTimeout(r, 3500));

    // BOT（シュガー）自身が投稿した要素をピンポイントで特定し、基準投稿番号(botPostId)を確定
    const myBotUser = (process.env.SNS_USER || '').replace(/^@/, '').trim().toLowerCase();
    let botPostInfo = null;

    for (let retry = 0; retry < 5; retry++) {
      botPostInfo = await page.evaluate((botUser, targetKeyword) => {
        const articles = Array.from(document.querySelectorAll('article.post, .post'));
        for (const art of articles) {
          const isFeatured = 
            art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
            art.querySelector('.hl-tag') !== null ||
            (art.innerHTML && art.innerHTML.includes('hl-tag'));

          if (isFeatured) continue;

          const nameEl = art.querySelector('.post-name');
          const handleEl = art.querySelector('.post-handle');
          const bodyEl = art.querySelector('.post-body');
          const idEl = art.querySelector('.post-id');

          const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
          const handle = handleEl ? (handleEl.innerText || handleEl.textContent || '').replace(/^@/, '').trim() : '';
          const body = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';
          const rawId = idEl ? idEl.innerText.replace('#', '').trim() : (art.dataset.id || '');
          const postId = rawId ? parseInt(rawId, 10) : null;

          const isSugar = name.includes('シュガー') || (botUser && handle.toLowerCase() === botUser);
          const isBotPost = body.includes('【全国アナウンス（BOT）】') || (targetKeyword && body.includes(targetKeyword));

          if ((isSugar || isBotPost) && postId) {
            return {
              postId,
              name,
              handle,
              bodySnippet: body.slice(0, 35)
            };
          }
        }
        return null;
      }, myBotUser, keyword);

      if (botPostInfo) break;
      console.log(`BOT投稿の検出を再試行中 (${retry + 1}/5)...`);
      await page.evaluate(() => window.scrollBy(0, 100));
      await new Promise(r => setTimeout(r, 2000));
    }

    const botPostId = botPostInfo?.postId || null;
    if (botPostInfo) {
      console.log(`[基準BOT投稿番号を確定] #${botPostId} (投稿者: ${botPostInfo.name || 'シュガー'} / 本文: "${botPostInfo.bodySnippet}...")`);
    } else {
      console.log("⚠️ BOT投稿の固有IDが自動検出できませんでした。以降の最新投稿を全件走査します。");
    }

    // タイピング選手権の場合：制限時間5分(300秒)で審査！
    if (isEventHour && keyword) {
      console.log("--------------------------------------------------");
      console.log(`[イベント開始] 制限時間: 5分間 (お題キーワード: 『${keyword}』 / 賞金: ${eventCoins}コイン)`);
      if (botPostId) {
        console.log(`※お題投稿(#${botPostId})より後の新しい投稿で、キーワード『${keyword}』を含むコメントを審査します。`);
      } else {
        console.log(`※これ以降の新しい投稿で、キーワード『${keyword}』を含むコメントを審査します。`);
      }
      console.log("--------------------------------------------------");

      const startTime = Date.now();
      const competitionDurationMs = 5 * 60 * 1000;
      const qualifiedSubmissions = new Map();

      while (Date.now() - startTime < competitionDurationMs) {
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const remainingSec = Math.max(0, 300 - elapsedSec);

        const foundList = await page.evaluate((targetKeyword, myBotHandle, basePostId) => {
          const results = [];
          const articles = Array.from(document.querySelectorAll('article.post, .post'));
          const normKey = targetKeyword.replace(/[\s\r\n\t　]/g, '').toLowerCase();

          articles.forEach((art, index) => {
            const isFeatured = 
              art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
              art.querySelector('.hl-tag') !== null ||
              (art.innerHTML && art.innerHTML.includes('hl-tag'));

            if (isFeatured) return;

            const bodyEl = art.querySelector('.post-body');
            const bodyText = (bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '').trim();
            const normBody = bodyText.replace(/[\s\r\n\t　]/g, '').toLowerCase();

            // 「その単語が入っていれば正解」の部分一致判定
            if (normBody.includes(normKey)) {
              const handleEl = art.querySelector('.post-handle');
              const nameEl = art.querySelector('.post-name');
              const idEl = art.querySelector('.post-id');

              let handle = handleEl ? (handleEl.innerText || handleEl.textContent || '') : '';
              const name = nameEl ? (nameEl.innerText || nameEl.textContent || '') : '';
              const rawId = idEl ? idEl.innerText.replace('#', '').trim() : (art.dataset.id || '');
              const postId = rawId ? parseInt(rawId, 10) : null;
              handle = handle.replace(/^@/, '').trim();

              const isAfterBot = (!basePostId || !postId || postId > basePostId);
              const isNotMe = handle.toLowerCase() !== myBotHandle.toLowerCase() && !name.includes('シュガー');

              if (handle && isNotMe && !bodyText.includes('【全国アナウンス（BOT）】') && isAfterBot) {
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
        }, keyword, myBotUser, botPostId);

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

        // タイムラインを最新化
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
        // 投稿番号(postId)が最も小さいユーザーを最速1位と判定
        const sorted = Array.from(qualifiedSubmissions.values()).sort((a, b) => {
          if (a.postId && b.postId) return a.postId - b.postId;
          return a.discoveredAt - b.discoveredAt;
        });
        winner = sorted[0];
        console.log(`[最速1位確定] @${winner.handle} さん (#${winner.postId || 'IDなし'} - ${winner.name})`);
      } else {
        console.log("[審査結果] 制限時間内に正解者の投稿はありませんでした。");
      }

      // 送金処理 ＆ 優勝者発表
      if (winner) {
        console.log(`優勝者の @${winner.handle} さんへ${eventCoins}コインを送金します...`);
        try {
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

          await page.waitForSelector('#send', { timeout: 10000 });
          await page.click('#send');
          await new Promise(r => setTimeout(r, 1500));

          await page.waitForSelector('#mf-h', { timeout: 10000 });
          await page.type('#mf-h', winner.handle, { delay: 30 });

          await page.waitForSelector('#mf-a', { timeout: 10000 });
          await page.type('#mf-a', String(eventCoins), { delay: 30 });

          await page.waitForSelector('#mf-m', { timeout: 10000 });
          await page.type('#mf-m', `タイピング選手権 優勝賞金 (${eventCoins}コイン)`, { delay: 30 });
          await new Promise(r => setTimeout(r, 1500));

          // 送金確定ボタンをクリック
          await page.evaluate(() => {
            const submitBtns = Array.from(document.querySelectorAll('button'));
            const sBtn = submitBtns.find(b => (b.innerText || '').includes('送金') || (b.innerText || '').includes('送信'));
            if (sBtn) sBtn.click();
          });
          await new Promise(r => setTimeout(r, 3000));
          console.log(`@${winner.handle} さんへの${eventCoins}コイン送金が正常完了しました！`);
        } catch (transferErr) {
          console.error("送金処理中にエラーが発生しました:", transferErr.message);
        }

        // ホームに戻って優勝者発表メッセージを自動投稿
        try {
          console.log("優勝者発表メッセージを投稿中...");
          await page.goto("https://national-sns.vercel.app/", { waitUntil: "networkidle2" });
          await new Promise(r => setTimeout(r, 2000));

          const winnerDisplayName = winner.name ? (' (' + winner.name + ')') : '';
          const winnerTitle = isManualEvent ? "【不定期型イベント結果発表】\n優勝者は" : "本日のイベント優勝者は";
          const resultMsg = `【全国アナウンス（BOT）】\n${winnerTitle}\n@${winner.handle} さん${winnerDisplayName}でした！\n\n制限時間5分の中で、最速での正解おめでとうございます！\n優勝賞金${eventCoins}コインを送金しました。\n次回のイベントもお楽しみに！\n#全国アナウンスBOT`;

          await page.waitForSelector('#c-body', { timeout: 15000 });
          await page.type('#c-body', resultMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          await new Promise(r => setTimeout(r, 4000));
          console.log("優勝者発表メッセージの投稿完了！");
        } catch (announceErr) {
          console.error("優勝発表メッセージ投稿中にエラー:", announceErr.message);
        }
      } else {
        // 正解者なしの場合の投稿
        try {
          console.log("正解者なしメッセージを投稿中...");
          await page.goto("https://national-sns.vercel.app/", { waitUntil: "networkidle2" });
          await new Promise(r => setTimeout(r, 2000));

          const noWinnerMsg = isManualEvent
            ? "【全国アナウンス（BOT）】\n【不定期型イベント終了】\nタイピング選手権は終了しました。\n制限時間5分以内に正解者はいませんでした。\nまた次回の挑戦をお待ちしています！\n#全国アナウンスBOT"
            : "【全国アナウンス（BOT）】\n本日のデイリータイピング選手権は終了しました。\n制限時間5分以内に正解者はいませんでした。\nまた次回の挑戦をお待ちしています！\n#全国アナウンスBOT";
          await page.waitForSelector('#c-body', { timeout: 15000 });
          await page.type('#c-body', noWinnerMsg, { delay: 30 });
          await new Promise(r => setTimeout(r, 1000));
          await clickPostButton(page);
          await new Promise(r => setTimeout(r, 4000));
          console.log("正解者なしメッセージの投稿完了！");
        } catch (noWinErr) {
          console.error("正解者なし投稿中にエラー:", noWinErr.message);
        }
      }
    }

    console.log("すべての処理が正常に完了しました！");
  } catch (error) {
    console.error(`エラー発生 (試行 ${retryCount + 1}): `, error.message);
    if (page) {
      await page.screenshot({ path: `error-debug-${retryCount + 1}.png`, fullPage: true }).catch(() => {});
    }

    if (retryCount < maxRetries) {
      console.log(`5秒後にリトライします (${retryCount + 1}/${maxRetries})...`);
      if (browser) await browser.close().catch(() => {});
      await new Promise(r => setTimeout(r, 5000));
      return executeBotPost(retryCount + 1);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

executeBotPost().catch(err => {
  console.error("致命的エラーで終了しました:", err);
  process.exit(1);
});
