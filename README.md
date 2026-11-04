# FoodieHub

FoodieHub is a responsive food-ordering application with a separate HTML/CSS/JavaScript frontend and a Node.js/Express API.

## Live frontend

GitHub Pages: https://shagun299.github.io/fodie/

**Important:** GitHub Pages publishes static files only. It cannot run Node.js, SQLite, customer authentication or payment webhooks. The frontend remains in demo/local-browser mode until you deploy the API and configure its URL.

## Project layout

- `fit check/` — standalone FitTrack application (`index.html`, `style.css`, `app.js`).

- \`index.html\` — page structure, sections, forms and dialogs.
- \`assets/css/styles.css\` — responsive styling, themes and component states.
- \`assets/js/app.js\` — menu, search, favourites, cart, customisation, checkout, order tracking and dashboards.
- \`assets/js/config.js\` — base URL for the separately hosted API.
- \`data/menu.json\` — starter menu catalogue.
- \`server/index.js\` — Express application, checkout, payment verification, order tracking and analytics.
- \`server/production.js\` — customer/admin sessions, password hashing, address book, menu management, stock, coupons, audit logs, webhooks and refunds.
- \`tests/production.test.js\` — backend integration and security tests.

## Local development

Requirements: Node.js 20 or newer.

\`\`\`bash
npm install
npm run check
npm test
npm start
\`\`\`

Open http://localhost:3000. SQLite is initialized automatically under \`server/data\` unless \`DATA_DIR\` is set.

## Production deployment

Use a Node.js web-service host such as Render or Railway. Do not deploy the API on GitHub Pages.

Suggested Render settings:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | \`npm install\` |
| Start command | \`npm start\` |
| Health check | \`/api/health\` |
| Persistent disk mount | \`/var/data\` |
| Instance count | One instance for the SQLite deployment |

Add the variables from \`.env.example\` in the hosting provider's secret/environment settings. At minimum:

1. \`NODE_ENV=production\`
2. \`DATA_DIR=/var/data\` and attach a persistent disk at that exact path.
3. \`ALLOWED_ORIGINS=https://shagun299.github.io\` (include any custom frontend domain too).
4. \`JWT_SECRET\` as a unique random secret of at least 32 characters.
5. \`ADMIN_EMAIL\` and \`ADMIN_PASSWORD_HASH\`. Run \`node scripts/hash-password.js\` locally to create the scrypt hash. Do not put the plain password in GitHub.
6. Configure \`ADMIN_API_KEY\` only if you are continuing to use the existing admin-key form in the frontend.

The API deliberately refuses to start in production without a strong \`JWT_SECRET\` and an explicit \`ALLOWED_ORIGINS\` list.

### Connect the GitHub Pages frontend

After the API service is deployed and its health URL works, edit \`assets/js/config.js\` and set the public API base URL:

\`\`\`js
window.FOODIEHUB_API_URL = "https://YOUR-API-HOST";
\`\`\`

This URL is public and is not a secret. Never place database credentials, JWT signing secrets, Razorpay secrets or admin keys in \`config.js\`. Commit the change to \`main\`; GitHub Actions will publish the updated static frontend.

### Razorpay setup

1. Start with Razorpay Test Mode credentials.
2. Add \`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\` and \`RAZORPAY_WEBHOOK_SECRET\` as server environment variables.
3. In the Razorpay dashboard, add the webhook URL \`https://YOUR-API-HOST/api/payments/webhook\`.
4. Subscribe to \`payment.captured\`, \`payment.failed\` and \`order.paid\`.
5. Test successful payments, failed payments, duplicate webhook delivery, cancellations and refunds before switching to Live Mode.

The server calculates the order price, validates coupon eligibility, reserves tracked stock, creates the Razorpay order, verifies payment signatures and reconciles webhook events. Refunds are initiated from the protected admin refund endpoint.

## Backend capabilities

### Customer accounts

- \`POST /api/auth/register\` and \`POST /api/auth/login\`
- \`GET /api/auth/me\`, \`PATCH /api/auth/me\`, \`POST /api/auth/logout\`
- \`GET /api/auth/orders\`
- \`GET /api/auth/addresses\`, \`POST /api/auth/addresses\`, \`DELETE /api/auth/addresses/:id\`

Passwords are hashed with Node.js scrypt. Authenticated endpoints use signed, expiring bearer sessions stored in the database. Guest checkout and phone-based order tracking remain supported.

### Menu, stock and coupons

- Public menu and category endpoints return only active dishes and include availability/stock metadata.
- Admin menu APIs can add, edit, disable and archive dishes.
- Admin inventory APIs can enable quantity tracking, update quantities and prevent checkout from overselling tracked dishes. A \`null\` quantity means stock tracking is not enabled for that dish.
- Coupon rules live in SQLite, not only in frontend JavaScript. Admin APIs can create, edit, activate and disable coupon codes. Usage limits are claimed inside the order transaction and released for failed/cancelled orders.

### Orders and payments

- Server-side price, customisation, coupon, tax and delivery calculations.
- Atomic order creation and inventory reservations.
- Customer order history when checkout includes a valid customer bearer token.
- Guest order tracking using order number and checkout phone.
- Razorpay order creation and payment signature/provider verification.
- Signed webhook verification, event de-duplication and payment failure cleanup.
- Protected admin order status changes and Razorpay refunds.

### Admin APIs

The legacy \`ADMIN_API_KEY\` bearer/header access remains supported. A password-based admin session can also be created through \`POST /api/admin/auth/login\` using \`ADMIN_EMAIL\` and the scrypt \`ADMIN_PASSWORD_HASH\`.

Protected endpoints include:

- \`GET /api/admin/orders\`, \`GET /api/admin/orders/:orderNumber\`, \`PATCH /api/admin/orders/:orderNumber\`
- \`POST /api/admin/orders/:orderNumber/refund\`
- \`GET/POST/PATCH/DELETE /api/admin/menu...\`
- \`GET/PATCH /api/admin/inventory...\`
- \`GET/POST/PATCH/DELETE /api/admin/coupons...\`
- \`GET /api/admin/customers\`, \`GET /api/admin/newsletter\`, \`GET /api/admin/audit-logs\`
- \`GET /api/admin/analytics\`

## Database and scaling notes

The current app uses SQLite with WAL mode and foreign keys. For a small, single-instance restaurant deployment, this is suitable only when the database directory is mounted on persistent storage and backups are configured. Keep the service to one application instance; do not run multiple API replicas against the same SQLite file. For multi-instance/high-volume operation, migrate the data layer to managed PostgreSQL before scaling.

Back up the persistent database regularly, test restoration, monitor health/error logs and set a retention policy for customer data. Protect the hosting account with MFA and rotate admin/JWT/payment secrets.

## Production readiness boundaries

The backend code and API are implemented, but a production launch still requires your hosting account, persistent disk, environment secrets, Razorpay merchant approval/webhook setup and end-to-end live tests. I cannot activate those account-side resources from a GitHub commit alone.

The current website UI continues to support guest checkout and browser-local profile/dashboard behaviour. The customer authentication and account APIs are available, but a customer-facing sign-in/account interface and attaching the bearer token from the browser checkout still need a separate frontend integration pass. Email/phone verification, password reset delivery and transactional email/SMS providers are not configured yet. Do not treat the deployment as accepting real orders until those operational steps and payment tests are complete.
