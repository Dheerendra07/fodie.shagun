# FoodieHub

A polished, responsive food discovery and ordering website with a separate HTML, CSS and JavaScript frontend plus a Node.js/Express API.

## Live website

GitHub Pages: https://shagun299.github.io/fodie/

The GitHub Pages workflow publishes the static frontend whenever a commit reaches \`main\`. GitHub Pages cannot execute the Node.js backend; use the backend instructions below for server-side orders.

## Frontend

The repository keeps the page source readable and separated:

- \`index.html\` — semantic page structure, sections, forms, dialogs and the dish-card template.
- \`assets/css/styles.css\` — responsive styling, light/dark themes and component states.
- \`assets/js/app.js\` — menu filters, search, favourites, cart, coupons, checkout, order tracking and API calls.
- \`assets/js/config.js\` — optional URL for a separately hosted API.
- \`data/menu.json\` — 24 sample menu items and food imagery.

Open \`index.html\` directly or run the full-stack app locally as described below.

## Run the full website and backend locally

1. Install Node.js 20 or newer.
2. Clone this repository.
3. In the repository folder, run:

   \`\`\`bash
   npm install
   npm start
   \`\`\`

4. Open http://localhost:3000

The backend creates \`server/data/foodiehub.sqlite\` automatically. Orders and newsletter sign-ups are stored in that SQLite database.

For live code reloading during development, run \`npm run dev\`.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | \`/api/health\` | API and database health |
| GET | \`/api/menu\` | Menu data |
| GET | \`/api/categories\` | Menu categories |
| POST | \`/api/orders\` | Validate prices and save a delivery-payment order |
| GET | \`/api/orders/track?order=...&phone=...\` | Track an order with order number and checkout phone |
| POST | \`/api/newsletter\` | Save a newsletter email |
| GET | \`/api/admin/orders\` | Admin order list (protected) |
| PATCH | \`/api/admin/orders/:orderNumber\` | Update order status (protected) |

### Demo offers

- \`HUB50\` — 50% off eligible baskets above ₹699, up to ₹200 off.
- \`FOOD25\` — 25% off eligible baskets above ₹299, up to ₹100 off.
- Some menu items already show up to 50% off against their listed original price.

The server recalculates item prices, coupon eligibility, delivery and tax. It does not trust totals sent by the browser.

## Deploy the backend

GitHub Pages is static hosting. To accept centrally stored orders, deploy this repository as a Node web service on Render, Railway or another Node.js host:

- Build command: \`npm install\`
- Start command: \`npm start\`
- Health-check path: \`/api/health\`
- Set \`NODE_ENV=production\`.
- Set \`DATA_DIR\` to a persistent mounted folder, for example \`/var/data\`, when your hosting plan supports a persistent disk.
- Set \`ALLOWED_ORIGINS\` to the exact frontend origin, for example \`https://shagun299.github.io\`.
- Set a long random \`ADMIN_API_KEY\` before using the admin endpoints.
- To enable online checkout, set \`RAZORPAY_KEY_ID\` and \`RAZORPAY_KEY_SECRET\` as backend environment variables. Start with Razorpay Test Mode keys; use Live Mode keys only after account and website approval.

After the backend is deployed, put its base URL in \`assets/js/config.js\`:

\`\`\`js
window.FOODIEHUB_API_URL = "https://YOUR-BACKEND-HOST";
\`\`\`

Commit that change and let GitHub Pages deploy again. Do not put \`ADMIN_API_KEY\`, database credentials or payment secrets in frontend files or this public repository.

## Important project boundaries

- If the backend is offline, the website still lets you browse, filter, favourite and build a cart. Checkout then uses a clearly identified browser-only demo order.
- When the backend is online, orders and newsletter sign-ups are stored in SQLite on the server. Use persistent storage on the hosting provider or orders may be lost when its filesystem is reset.
- Cash on delivery and UPI on delivery work as delivery-payment choices. Secure online checkout appears only after the separately hosted backend has Razorpay keys configured.
- Razorpay secrets remain on the backend. The server creates the payment order, verifies the signature and checks the payment amount and order before confirming a captured payment. A GitHub Pages-only deployment cannot process online payments by itself.
- The menu, photographs, prices, offer rules and brand copy are sample project content. Replace them with verified restaurant information before taking real customer orders.

## Security notes

The API uses Helmet security headers, CORS configuration, rate limiting, input validation, server-side price calculation and an API-key check for admin routes. For a public production launch, add HTTPS-only hosting, privacy/retention policies, monitored backups, verified payment integration and a proper admin login system.
