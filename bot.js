import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

/**
 * 統合版 全国アナウンスBOT
 */

function createPostMessage(hour) {
  if (hour === 4) {
    return "【全国アナウンス（BOT）】\nおはよう！\n朝4時に なにしてるんだい？\n#全国アナウンスBOT";
  }
  return `【全国アナウンス（BOT）】\n${hour}時になりました。\n#全国アナウンスBOT`;
}

// テキストエリアへ一括で確実に文字を入力するヘルパー関数
async function setPostText(page, text) {
  await page.waitForSelector('#c-body', { timeout: 15000 });
  await page.evaluate((content) => {
    const textarea = document.querySelector('#c-body');
    if (textarea) {
      textarea.value = content;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, text);
  await new Promise(r => setTimeout(r, 1000));
}

// 画像添付ヘルパー関数 (ファイル選択ダイアログ呼び出し & uploadFile の両対応)
async function attachImage(page, imagePath) {
  console.log(`[画像添付開始] パス: ${imagePath}, 存在: ${fs.existsSync(imagePath)}`);
  if (!fs.existsSync(imagePath)) {
    console.log("⚠️ 添付する画像ファイルが見つかりません。");
    return;
  }

  // ホーム画面の投稿フォーム内の添付要素(#c-file または label.attach / svg)を待機
  await page.waitForSelector('#c-file, label.attach, label.attach svg', { timeout: 15000 });

  let attached = false;

  // 1. ユーザー操作と同様に添付ボタン(svg/label)をクリックしてファイルダイアログ経由で添付を試みる
  try {
    console.log("画像添付ボタン(label.attach svg)のクリックとファイル選択待機中...");
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 5000 }),
      page.evaluate(() => {
        const svg = document.querySelector('label.attach svg');
        const label = document.querySelector('label.attach');
        const fileIn = document.querySelector('#c-file') || document.querySelector('input[type="file"]');

        if (label && typeof label.click === 'function') {
          label.click();
        } else if (svg) {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
            svg.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
          });
        } else if (fileIn && typeof fileIn.click === 'function') {
          fileIn.click();
        }
      })
    ]);

    await fileChooser.accept([imagePath]);
    attached = true;
    console.log("✓ fileChooser による画像の選択に成功しました。");
  } catch (chooserErr) {
    console.log("⚠️ fileChooser 経由での選択に失敗またはタイムアウトしました。直接 uploadFile を試行します:", chooserErr.message);
  }

  // 2. input[type="file"] または #c-file へ直接 uploadFile を実行 (フォールバック)
  if (!attached) {
    try {
      const fileInput = await page.$('#c-file') || await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(imagePath);
        attached = true;
        console.log("✓ uploadFile による直接添付に成功しました。");
      }
    } catch (uploadErr) {
      console.log("⚠️ uploadFile 失敗:", uploadErr.message);
    }
  }

  // 3. changeイベントを明示的に発火させ、DOM上のファイル添付状態を確定させる
  await page.evaluate(() => {
    const el = document.querySelector('#c-file') || document.querySelector('input[type="file"]');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // 添付ファイル名(#c-fname)または files の反映を確認
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('#c-file') || document.querySelector('input[type="file"]');
      const fname = document.querySelector('#c-fname');
      const hasFiles = el && el.files && el.files.length > 0;
      const showsName = fname && !fname.hidden && (fname.textContent || '').trim().length > 0;
      return hasFiles || showsName;
    }, { timeout: 5000 });
    console.log("✓ 画像添付が正常に完了し、UIへ反映されました。");
  } catch (waitErr) {
    console.log("⚠️ 添付確認待機タイムアウト (処理を継続します)");
  }

  await new Promise(r => setTimeout(r, 2000));
}

async function clickPostButton(page) {
  await page.waitForFunction(() => {
    const textarea = document.querySelector('#c-body');
    return textarea && textarea.value && textarea.value.trim().length > 0;
  }, { timeout: 15000 });

  await new Promise(r => setTimeout(r, 1500));

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
        if (btn.form) {
          btn.form.requestSubmit ? btn.form.requestSubmit() : btn.form.submit();
        } else {
          btn.click();
        }
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

    const now = new Date();
    const jstOffset = 9 * 60;
    const jstDate = new Date(now.getTime() + (jstOffset + now.getTimezoneOffset()) * 60000);
    const jstHour = jstDate.getHours();
    const jstMinutes = jstDate.getMinutes();

    const args = process.argv.slice(2);
    const rawMode = (process.env.MODE || process.env.INPUT_MODE || '').trim().toLowerCase();

    const isForcePost = args.includes('--force') || rawMode === 'force_post' || process.env.FORCE_POST === 'true';
    const isDryRun = rawMode === 'dry_run' || process.env.DRY_RUN === 'true';

    const isMorningBot = (jstHour === 4);
    const message = createPostMessage(jstHour);

    console.log("==================================================");
    console.log(`[BOT実行開始] JST時刻: ${jstHour}時${jstMinutes}分 (試行: ${retryCount + 1})`);
    if (isMorningBot) {
      console.log(`[4時アナウンスモード] 画像添付付きでおはようメッセージを投稿します。`);
    } else {
      console.log(`[通常アナウンスモード] ${jstHour}時のアナウンスを投稿します。`);
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
    console.log("3. メッセージを入力中...");
    await setPostText(page, message);
    await new Promise(r => setTimeout(r, 1000));

    if (isMorningBot) {
      const imagePath = path.resolve('./george.jpg');
      await attachImage(page, imagePath);
    }

    await page.screenshot({ path: '2-post-before-submit.png', fullPage: true });

    if (isDryRun) {
      console.log("[Dry Run モード] 投稿直前のスクリーンショットを保存し終了します。");
      return;
    }

    console.log("4. 投稿ボタンをクリック中...");
    await clickPostButton(page);
    console.log("アナウンス投稿実行完了！タイムラインの反映を待機中...");
    await new Promise(r => setTimeout(r, 5000));

    await page.screenshot({ path: '3-post-after-submit.png', fullPage: true });
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

// ©︎kakuzatou
