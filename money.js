// 【送金テスト用スクリプトの断片】
const targetUser = 'zav'; // テストしたいユーザー名を入れてね
const coinAmount = '1';
const messageText = '【BOT】送金テスト';

// 1. 「コインを送る」ボタン（ID: send）をクリックしてモーダルを開く
await page.waitForSelector('#send', { timeout: 10000 });
await page.click('#send');
await new Promise(r => setTimeout(r, 1000)); // モーダルが開くのを待つ

// 2. ユーザーID（ID: mf-h）を入力
await page.waitForSelector('#mf-h', { timeout: 5000 });
await page.type('#mf-h', targetUser, { delay: 50 });

// 3. 金額（ID: mf-a）を入力
await page.type('#mf-a', coinAmount, { delay: 50 });

// 4. コメント（ID: mf-m）を入力
await page.type('#mf-m', messageText, { delay: 50 });
await new Promise(r => setTimeout(r, 1000));

// 5. 送るボタン（ID: modal-ok）をクリック
await page.click('#modal-ok');
console.log(`${targetUser} に ${coinAmount} コインを送金しました。`);
