# Offline browser checks SOL VPN

Нужны Node.js и Playwright/Chromium (`require('playwright')`).
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` задаёт путь к установленному Chrome,
если bundled Chromium отсутствует. Runtime-зависимостей приложению не добавлено.

```sh
node --check app.js
node --check appearance.js
node tests/appearance.cjs
node tests/payment-cleanup.cjs
node tests/payment-methods.cjs
node tests/stars-checkout.cjs
node tests/payment-expiry.cjs
node tests/admin-users.cjs
node tests/info-faq.cjs
```

Все тесты поднимают временный локальный HTTP API, подменяют Telegram SDK
и блокируют внешние запросы. Настоящие провайдеры, сообщения, VPN и production
не вызываются. Названия/ID пользователей и API-квитанции искусственные.

| Suite | Сценарии | Область |
| --- | ---: | --- |
| appearance | 16 | 6 тем, Classic Light/Dark, параметры, контраст, 3 перехода/режима, пресеты, owner isolation, первый paint, storage/старый WebView, клавиатура, отсутствие snapshots на ползунках |
| payment-cleanup | 10 | восстановление без выбора, cancel, очистка, server expiry once, локальный ноль, late paid/newer attempt, все VIP, свежий backend и stale pending |
| payment-methods | 22 | RUB/Stars quotes, chooser, bot-first/безопасный GET fallback, ошибки/повторы, quote snapshot, focus/свайп/анимация/размеры |
| stars-checkout | 12 | native invoice, точная сумма, idempotency key, отмена/ошибка, повторы/перезапуск, серверное подтверждение |
| payment-expiry | 12 | исходный TTL, clock skew, reload, amber60, новый счёт по явному действию, holds/новая цена, identity guards, queue concurrency3 |
| admin-users | 19 | поиск/пагинация, VIP по ID, защищённые права, profile/message, черновики/scroll, старый API, обычный пользователь |
| info-faq | 20 | 9 ответов, один Helper Stars, wave/Liquid Rise, reset, resize/высота, reduced motion, disclosure, touch/keyboard/Unicode |

Всего — **111 проверок**. Браузерные JavaScript errors также проверяются.
Пять прежних suites адаптированы под новое требование очищать временный UI:
после cancel нужна повторная явная выборка тарифа; старый expired не остаётся
видимой карточкой, а незавершённые финансовые ID сохраняются для сверки.

Файл browser-fixture.cjs — общий mock для двух новых suites, не runtime-код.
Он моделирует исходный server expiry и поздний paid; начисление настоящей
подписки фронтендом не имитируется как допустимый production-механизм.
Фактическую подписку приложение читает из backend bootstrap.

Необязательные снимки:

- SOL_APPEARANCE_SCREENSHOT_DIR — палитры и настройки.
- SOL_PAYMENT_EXPIRY_SCREENSHOT_DIR — таймер 320/440 px.
- SOL_CHECKOUT_SCREENSHOT_DIR — sheet 440 px.
- SOL_FAQ_SCREENSHOT_DIR — FAQ и Helper Stars 320/390 px.
- SOL_ADMIN_SCREENSHOT_DIR — эффективный VIP/белые SVG.

Тексты восьми исходных ответов FAQ сохранены; новый короткий ответ Helper Stars
закреплён отдельно. Волна: локальная смена280 ms, шаг12 ms, max1200 ms,
перекрытие40 ms, высота420 ms. Одна кнопка поднимается400 ms после паузы300 ms.
Пауза предотвращает обрезание видимой строки при росте терминала.

Инструкции публикации/отката и оставшиеся проверки физических Android/iOS —
PERSONALIZATION_RELEASE.md. Backend e6bb6d… и его production-БД этим выпуском
не изменяются. Реальные sandbox-покупки требуют отдельного согласования.
