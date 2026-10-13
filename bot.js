// 現在の日本時間を取得
const date = new Date();
const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
const postMessage = `【BOT】${jstHours}時になりました。`;

const TARGET_URL = 'https://national-sns.vercel.app';

async function run() {
  try {
    // 1. ログイン試行（フォームデータの送信）
    const loginParams = new URLSearchParams();
    loginParams.append('handle', 'kakuzatou');
    loginParams.append('pass', 't20120627');

    const loginRes = await fetch(`${TARGET_URL}/login`, { // ※一般的なログインエンドポイントを想定
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: loginParams,
      redirect: 'manual'
    });

    // レスポンスヘッダーからCookieを取得
    const setCookie = loginRes.headers.get('set-cookie');

    // 2. 投稿試行
    const postParams = new URLSearchParams();
    postParams.append('body', postMessage);

    const postRes = await fetch(`${TARGET_URL}/post`, { // ※一般的な投稿エンドポイントを想定
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': setCookie || ''
      },
      body: postParams
    });

    console.log(`ステータスコード: ${postRes.status}`);
    console.log(`投稿メッセージ: ${postMessage}`);

  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

run();
