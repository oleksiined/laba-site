export const config = { matcher: ['/', '/services', '/blog', '/sampling', '/order-sampling', '/methods', '/about', '/contacts', '/for-labs', '/contract'] };

const BASE = 'https://laba.zemlerob.com.ua';

const PAGE_META = {
  '/':               { img: 'og-image.png',          title: 'LABA — онлайн-сервіс лабораторних досліджень для агробізнесу', desc: 'Замовляйте аналізи ґрунту, води, добрив, насіння, зерна й рослин онлайн. Відбір проб, статус замовлення й результати з агрономічними висновками.' },
  '/services':       { img: 'og-services.png',        title: 'Каталог аналізів ґрунту, води, добрив — LABA', desc: 'Пакети й окремі дослідження: агрохімічний аналіз ґрунту, якість води, добрива, посівна якість насіння, зерно, рослинна діагностика. Ціни й терміни онлайн.' },
  '/blog':           { img: 'og-blog.png',            title: 'Агрономічний гід — статті про аналізи й живлення', desc: 'Практичні статті для агрономів: які аналізи робити перед посівом, як читати результати, діагностика живлення рослин і якість насіння.' },
  '/sampling':       { img: 'og-sampling.png',        title: 'Як відібрати пробу ґрунту, води, рослин — LABA', desc: 'Покрокові інструкції з відбору та пакування проб ґрунту, води, рослин, добрив, насіння й зерна. PDF-пам\'ятки й етикетки для зразків.' },
  '/order-sampling': { img: 'og-order-sampling.png',  title: 'Замовити відбір проб ґрунту — LABA', desc: 'Виїзд фахівця для відбору проб ґрунту за контурами ваших полів (KML, KMZ, GeoJSON, SHP). Оформіть заявку онлайн.' },
  '/methods':        { img: 'og-methods.png',         title: 'Методи лабораторних досліджень і стандарти — LABA', desc: 'Каталог методів і стандартів, за якими виконуються дослідження ґрунту, води, добрив і рослин: pH, Mehlich 3, DTPA, ICP та інші.' },
  '/about':          { img: 'og-about.png',           title: 'Про LABA — онлайн-сервіс лабораторних досліджень', desc: 'Одне вікно для лабораторних досліджень у агробізнесі: ви замовляєте онлайн, ми організовуємо відбір, аналіз у лабораторіях-партнерах і висновки.' },
  '/contacts':       { img: 'og-contacts.png',        title: 'Контакти LABA — замовлення аналізів і консультації', desc: 'Зв\'яжіться з LABA: +380 67 181 99 67, Пн-Пт 09:00–18:00. Допоможемо обрати аналіз, організувати відбір і доставку зразків.' },
  '/for-labs':       { img: 'og-for-labs.png',        title: 'Стати лабораторією-партнером LABA', desc: 'Отримуйте замовлення від агровиробників через LABA: ми беремо на себе продажі, заявки й клієнтів, ви робите дослідження. Залиште заявку.' },
  '/contract':       { img: 'og-contract.png',        title: 'Публічний договір (оферта) — LABA', desc: 'Умови замовлення, оплати, відбору й доставки зразків, скасування та повернення коштів сервісу LABA (ТОВ «ЗЕМЛЕРОБ ХАБ»).' },
};

const BOT_UA = /bot|crawler|spider|facebookexternalhit|twitterbot|telegrambot|whatsapp|viber|slackbot|linkedinbot|discordbot|vkshare/i;

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_UA.test(ua)) return;

  const url = new URL(request.url);
  const meta = PAGE_META[url.pathname];
  if (!meta) return;

  const imgUrl = `${BASE}/${meta.img}`;
  const pageUrl = `${BASE}${url.pathname}`;

  const html = `<!doctype html><html><head>
<meta charset="UTF-8">
<title>${meta.title}</title>
<meta name="description" content="${meta.desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.desc}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="uk_UA">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.desc}">
<meta name="twitter:image" content="${imgUrl}">
</head><body></body></html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
