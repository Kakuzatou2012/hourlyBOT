const date = new Date();
const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();

const message = `【BOT】\n${jstHours}時になりました。`;
console.log(message);
