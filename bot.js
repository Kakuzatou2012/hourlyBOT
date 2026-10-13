const date = new Date();
const jstHours = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getHours();
console.log(`【BOT】${jstHours}時になりました。`);
