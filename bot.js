import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT (v5.3)
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

function createPostMessage(hour, keyword, isManualEvent, coins) {
  if (isManualEvent) {
    return `【全国アナウンス（BOT）】\n【不定期型イベント開催】\nタイピング選手権（制限時間5分）\n次のワードを最速で投稿したユーザーに\n${coins}コインを配布します！\n\nキーワード\n『${keyword}』\n#全国アナウンスBOT`;
  }
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に なにしてるんだい？\n#全国アナウンスBOT";
  }
  if (hour === 18) {
    return `【全国アナウンス（BOT）】\n18時になりました。\n\n【イベント】\nタイピング選手権（制限時間5分）\n次のワードを最速で投稿したユーザーに\n${coins}コインを配布します！\n\nキーワード\n『${keyword}』\n#全国アナウンスBOT`;
  }
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

// 送金処理を確実に行うためのヘルパー関数 (dryRunOptions: { isDryRun: boolean })
async function sendCoinsToUser(page, recipientHandle, amount, memo, dryRunOptions = { isDryRun: false }) {
  const isDryRun = !!dryRunOptions?.isDryRun;
  const cleanHandle = (recipientHandle || '').replace(/^@/, '').trim();
  console.log(`@${cleanHandle} さんへ ${amount} コインの送金画面へ移動中... ${isDryRun ? '(テスト・DryRunモード)' : ''}`);
  
  // チュートリアルポップアップが表示されている場合はスキップ
  const skipBtn = await page.$('.btn-skip, button.skip, #btn-skip, [data-t="skip"]');
  if (skipBtn) {
    await skipBtn.click().catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
  }

  // 国家・経済タブへダイレクト遷移
  console.log("国家/経済ページ (/#/nation/rich) へ遷移中...");
  await page.goto("https://national-sns.vercel.app/#/nation/rich", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // 経済タブの送金ボタン (#send) の表示を確認。万が一表示されない場合はフォールバック
  let sendBtnFound = false;
  for (let i = 0; i < 3; i++) {
    const sendBtn = await page.$('#send');
    if (sendBtn) {
      sendBtnFound = true;
      break;
    }
    // タブクリックでフォールバック
    await page.evaluate(() => {
      const econLink = Array.from(document.querySelectorAll('a, button, span, .tab')).find(l => (l.innerText || l.textContent || '').trim() === '経済');
      if (econLink) econLink.click();
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!sendBtnFound) {
    // 画面状態デバッグ用のスクショを保存して例外送出
    await page.screenshot({ path: 'error-send-button-not-found.png', fullPage: true }).catch(() => {});
    throw new Error("国家/経済タブの「コインを送る」ボタン (#send) が見つかりませんでした。");
  }

  // 送金モーダルを開くボタンを押す
  await page.click('#send');
  await new Promise(r => setTimeout(r, 2000));

  // 宛先入力 (#mf-h)
  await page.waitForSelector('#mf-h', { timeout: 15000 });
  await page.click('#mf-h', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#mf-h', cleanHandle, { delay: 40 });
  await page.evaluate(() => {
    const el = document.querySelector('#mf-h');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // 金額入力 (#mf-a)
  await page.waitForSelector('#mf-a', { timeout: 15000 });
  await page.click('#mf-a', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#mf-a', String(amount), { delay: 40 });
  await page.evaluate(() => {
    const el = document.querySelector('#mf-a');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // メモ入力 (#mf-m)
  await page.waitForSelector('#mf-m', { timeout: 15000 });
  await page.click('#mf-m', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#mf-m', memo, { delay: 40 });
  await page.evaluate(() => {
    const el = document.querySelector('#mf-m');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: '3-remittance-filled.png', fullPage: true }).catch(() => {});
  console.log(`[送金画面準備完了] @${cleanHandle} さんへの入力が完了しスクショ(3-remittance-filled.png)を保存しました。`);

  if (isDryRun) {
    console.log("[Dry Run モードのため送金実行ボタンは押さずに終了します]");
    return;
  }

  // フォーム内の実行ボタンを確実に特定してクリック（モーダルを開く #send ボタンを除外）
  const clicked = await page.evaluate(() => {
    const handleInput = document.querySelector('#mf-h');
    const container = handleInput ? handleInput.closest('form, .modal, .modal-content, div') : document;
    const btns = Array.from((container || document).querySelectorAll('button, input[type="submit"], input[type="button"]'));

    // #send 以外のボタンで、送金/送信/実行/Submitテキストを持つものを優先
    const sBtn = btns.find(b => {
      if (b.id === 'send') return false;
      const t = (b.innerText || b.textContent || b.value || '').trim();
      return t.includes('送金') || t.includes('送信') || t.includes('実行') || b.type === 'submit';
    }) || btns.find(b => b.id !== 'send');

    if (sBtn) {
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
        sBtn.dispatchEvent(new PointerEvent(evt, { bubbles: true, cancelable: true, view: window }));
      });
      if (sBtn.form) {
        sBtn.form.requestSubmit ? sBtn.form.requestSubmit() : sBtn.form.submit();
      }
      return true;
    }
    return false;
  });

  if (!clicked) {
    throw new Error("送金実行ボタンが見つかりませんでした。");
  }

  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: '4-remittance-done.png', fullPage: true }).catch(() => {});
  console.log(`@${cleanHandle} さんへの ${amount} コインの送金処理が完了しました！`);
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

    const now = new Date();
    const jstOffset = 9 * 60;
    const jstDate = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    const jstHour = jstDate.getHours();
    const jstMinutes = jstDate.getMinutes();

    const args = process.argv.slice(2);
    const rawMode = (process.env.MODE || process.env.INPUT_MODE || '').trim().toLowerCase();
    const isGitHubManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

    // 手動イベントや特定モードの判定
    const isExplicitEvent = 
      isGitHubManual ||
      rawMode === 'event_now' ||
      args.includes('--manual') ||
      args.includes('--event-now') ||
      args.includes('event') ||
      process.env.EVENT_NOW === 'true' ||
      process.env.MANUAL === 'true';

    const isForcePost = args.includes('--force') || rawMode === 'force_post' || process.env.FORCE_POST === 'true';
    const isExplicitDryRun = rawMode === 'dry_run' || process.env.DRY_RUN === 'true';

    const customKeyword = (process.env.CUSTOM_KEYWORD || '').trim();
    const eventCoins = parseInt(process.env.CUSTOM_COINS || '25', 10) || 25;

    // autoモードのときは18時のみ、手動のときは明示的にイベントモードにする
    const isScheduledEvent = (rawMode === 'auto' && jstHour === 18);
    const isManualEvent = isExplicitEvent && rawMode !== 'auto';
    
    const isEventHour = isManualEvent || isScheduledEvent;
    const isMorningBot = (jstHour === 4) && !isEventHour;

    const keyword = isEventHour ? (customKeyword || getRandomKeyword()) : null;
    const message = createPostMessage(jstHour, keyword, isManualEvent, eventCoins);

    const isDryRun = isExplicitDryRun || (!isManualEvent && !isForcePost && jstMinutes > 5 && !isScheduledEvent);

    console.log("==================================================");
    console.log(`[BOT実行開始] JST時刻: ${jstHour}時${jstMinutes}分 (試行: ${retryCount + 1})`);
    if (isManualEvent) {
      console.log("★【手動イベント開催モード】");
      console.log(`   不定期型イベントとして即時開催します (賞金: ${eventCoins}コイン / お題: 『${keyword}』)`);
    } else if (isScheduledEvent) {
      console.log("★【18時定時イベントモード】");
      console.log(`   デイリータイピング選手権を開催します (賞金: ${eventCoins}コイン / お題: 『${keyword}』)`);
    } else {
      console.log(`[通常アナウンスモード] ${jstHour}時のお手紙/アナウンスを投稿します。`);
    }
    console.log("==================================================");

    console.log("1. SNSへアクセス中...");
    await page.goto("https://national-sns.vercel.app/", { waitUntil: "networkidle2", timeout: 45000 });

    console.log("2. ログイン状態を確認中...");
    await page.waitForFunction(() => {
      return !!document.querySelector('#a-handle') || !!document.querySelector('#c-body');
    }, { timeout: 35000 });

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
        throw new Error("環境変数 SNS_USER または SNS_PASS が空です。");
      }

      await page.evaluate(() => {
        const loginTab = document.querySelector('button[data-mode="login"]');
        if (loginTab && !loginTab.classList.contains('active')) {
          loginTab.click();
        }
      });

      await page.waitForSelector('#a-handle', { timeout: 15000 });
      await page.click('#a-handle', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#a-handle', cleanUser, { delay: 35 });

      await page.waitForSelector('#a-pass', { timeout: 15000 });
      await page.click('#a-pass', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type('#a-pass', cleanPass, { delay: 35 });

      await page.evaluate(() => {
        const btn = document.querySelector('#auth-form button[type="submit"]') || document.querySelector('#auth-form .btn');
        if (btn) btn.click();
      });

      await page.waitForFunction(() => {
        const composer = !!document.querySelector('#c-body');
        const errEl = document.querySelector('#a-err');
        const hasErr = errEl && (errEl.textContent || '').trim().length > 0;
        return composer || hasErr;
      }, { timeout: 35000 });

      const authError = await page.evaluate(() => {
        const errEl = document.querySelector('#a-err');
        return errEl ? (errEl.textContent || '').trim() : '';
      });

      if (authError) {
        throw new Error(`ログインエラー: "${authError}"`);
      }

      await page.waitForSelector('#c-body', { timeout: 15000 });
      console.log(`✓ ログイン成功！`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.log("✓ 既にログイン済みです。");
    }

    const skipBtn = await page.$('.btn-skip, button.skip, #btn-skip');
    if (skipBtn) {
      await skipBtn.click().catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
    }

    await page.screenshot({ path: '1-login-success.png', fullPage: true });

    // 3. アナウンスメッセージ入力 & 投稿
    console.log("3. メッセージを入力・投稿中...");
    await page.waitForSelector('#c-body', { timeout: 15000 });
    await page.type('#c-body', message, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    if (isMorningBot) {
      const imagePath = path.resolve('./george.jpg');
      if (fs.existsSync(imagePath)) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(imagePath);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    await page.screenshot({ path: '2-post-before-submit.png', fullPage: true });

    if (isDryRun) {
      console.log("[Dry Run モード (テストモード)] 一番上のユーザーを取得して送金画面手前までテスト実行します...");
      const topUserHandle = await page.evaluate((myBotUser) => {
        const articles = Array.from(document.querySelectorAll('article.post, .post'));
        for (const art of articles) {
          const isFeatured =
            art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
            art.querySelector('.hl-tag') !== null;
          if (isFeatured) continue;

          const handleEl = art.querySelector('.post-handle');
          const nameEl = art.querySelector('.post-name');
          const bodyEl = art.querySelector('.post-body');

          const handle = handleEl ? (handleEl.innerText || handleEl.textContent || '').replace(/^@/, '').trim() : '';
          const name = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';
          const body = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : '';

          const isMe = handle.toLowerCase() === myBotUser.toLowerCase() || name.includes('シュガー') || body.includes('【全国アナウンス（BOT）】');
          if (handle && !isMe) {
            return handle;
          }
        }
        return null;
      }, myBotUser);

      const testRecipient = topUserHandle || 'test_user';
      console.log(`[Dry Run テスト対象宛先] @${testRecipient}`);
      await sendCoinsToUser(page, testRecipient, eventCoins, `タイピング選手権 優勝賞金 (テスト)`, { isDryRun: true });
      console.log("[Dry Run 正常完了]");
      return;
    }

    await clickPostButton(page);
    console.log("アナウンス投稿完了！タイムラインの反映を待機中...");
    await new Promise(r => setTimeout(r, 4000));

    // BOT自身の投稿を特定
    const myBotUser = (process.env.SNS_USER || '').replace(/^@/, '').trim().toLowerCase();
    let botPostInfo = null;

    for (let retry = 0; retry < 5; retry++) {
      botPostInfo = await page.evaluate((botUser, targetKeyword) => {
        const articles = Array.from(document.querySelectorAll('article.post, .post'));
        for (const art of articles) {
          const isFeatured = 
            art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
            art.querySelector('.hl-tag') !== null;

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
      await page.evaluate(() => window.scrollBy(0, 100));
      await new Promise(r => setTimeout(r, 2000));
    }

    const botPostId = botPostInfo?.postId || null;
    if (botPostInfo) {
      console.log(`[基準BOT投稿番号確定] #${botPostId}`);
    } else {
      console.log("⚠️ 基準BOT投稿IDが自動検出できなかったため、最新の投稿から走査します。");
    }

    // イベント中の5分間審査処理 (投稿後5分間タイマーで正解者を監視し、5分経過後に優勝者へ送金)
    if (isEventHour && keyword) {
      console.log(`[イベント審査開始] お題: 『${keyword}』 (投稿から5分間/300秒経過後に送金処理を実施します)`);

      const startTime = Date.now();
      const competitionDurationMs = 5 * 60 * 1000; // 5分間 (300,000ミリ秒) 待機＆スキャン
      const qualifiedSubmissions = new Map();
      let scanCycle = 0;

      while (Date.now() - startTime < competitionDurationMs) {
        scanCycle++;
        const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
        const remainingSec = Math.max(0, 300 - elapsedSec);

        try {
          if (scanCycle % 2 === 0) {
            await page.reload({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
          } else {
            await page.evaluate(async () => {
              if (window.SP?.views?.viewHome) {
                await window.SP.views.viewHome();
              } else {
                const tab = document.querySelector('button[data-tab="all"]');
                if (tab) tab.click();
              }
            });
          }
          await new Promise(r => setTimeout(r, 2500));
        } catch (e) {
          await page.reload({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 2000));
        }

        const scanResult = await page.evaluate((targetKeyword, myBotHandle, basePostId) => {
          const articles = Array.from(document.querySelectorAll('article.post, .post'));

          let botIndex = -1;
          articles.forEach((art, idx) => {
            const rawId = art.dataset.id || (art.querySelector('.post-id')?.innerText || '').replace('#', '').trim();
            const pid = rawId ? parseInt(rawId, 10) : null;
            if (basePostId && pid === basePostId) {
              botIndex = idx;
            } else if (botIndex === -1) {
              const body = (art.querySelector('.post-body')?.innerText || '').trim();
              if (body.includes('【全国アナウンス（BOT）】') && targetKeyword && body.includes(targetKeyword)) {
                botIndex = idx;
              }
            }
          });

          const normKey = targetKeyword.replace(/[\s\r\n\t ]/g, '').toLowerCase();
          const matched = [];
          const postsAbove = [];

          articles.forEach((art, idx) => {
            const isFeatured = 
              art.closest('#v11-pinwrap, #v11-pinned, .v14-hl-head, .v14-hl-body') !== null ||
              art.querySelector('.hl-tag') !== null;

            if (isFeatured) return;

            const nameEl = art.querySelector('.post-name');
            const handleEl = art.querySelector('.post-handle');
            const bodyEl = art.querySelector('.post-body');
            const idEl = art.querySelector('.post-id');

            const name = (nameEl ? (nameEl.innerText || nameEl.textContent || '') : '').trim();
            let handle = (handleEl ? (handleEl.innerText || handleEl.textContent || '') : '').replace(/^@/, '').trim();
            const bodyText = (bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '').trim();
            const rawId = art.dataset.id || (idEl ? idEl.innerText.replace('#', '').trim() : '');
            const postId = rawId ? parseInt(rawId, 10) : null;

            const isAbove = (botIndex !== -1 && idx < botIndex) || (basePostId && postId && postId > basePostId) || (!basePostId && idx < 5);
            const isNotMe = handle.toLowerCase() !== myBotHandle.toLowerCase() && !name.includes('シュガー') && !bodyText.includes('【全国アナウンス（BOT）】');

            if (isAbove) {
              const normBody = bodyText.replace(/[\s\r\n\t ]/g, '').toLowerCase();
              const isMatch = isNotMe && normBody.includes(normKey);

              postsAbove.push({
                postId,
                handle,
                name,
                bodySnippet: bodyText.slice(0, 35),
                isMatch
              });

              if (isMatch) {
                matched.push({
                  handle,
                  name,
                  text: bodyText,
                  postId: postId || 999999 + idx,
                  index: idx
                });
              }
            }
          });

          return {
            postsAboveCount: postsAbove.length,
            postsAboveList: postsAbove.slice(0, 5),
            matched
          };
        }, keyword, myBotUser, botPostId);

        for (const item of scanResult.matched) {
          if (!qualifiedSubmissions.has(item.handle)) {
            qualifiedSubmissions.set(item.handle, {
              ...item,
              discoveredAt: Date.now()
            });
            console.log(`★【正解検知！】@${item.handle} (${item.name}) - 「${item.text}」`);
          }
        }

        const remMin = Math.floor(remainingSec / 60);
        const remSec = remainingSec % 60;
        console.log(`[審査中 (残り${remMin}分${remSec}秒)] 新着スキャン数: ${scanResult.postsAboveCount}件 (正解者数: ${qualifiedSubmissions.size}名)`);

        await new Promise(r => setTimeout(r, 10000));
      }

      let winner = null;
      if (qualifiedSubmissions.size > 0) {
        const sorted = Array.from(qualifiedSubmissions.values()).sort((a, b) => {
          if (a.postId && b.postId) return a.postId - b.postId;
          return a.discoveredAt - b.discoveredAt;
        });
        winner = sorted[0];
        console.log(`[最速1位確定] @${winner.handle} (${winner.name})`);
      }

      if (winner) {
        try {
          await sendCoinsToUser(page, winner.handle, eventCoins, `タイピング選手権 優勝賞金 (${eventCoins}コイン)`);
        } catch (transferErr) {
          console.error("送金処理エラー:", transferErr.message);
        }

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
        } catch (announceErr) {
          console.error("優勝発表メッセージ投稿エラー:", announceErr.message);
        }
      } else {
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
        } catch (noWinErr) {
          console.error("正解者なし投稿エラー:", noWinErr.message);
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
