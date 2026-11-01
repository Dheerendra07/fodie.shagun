# FoodieHub

A responsive food discovery and delivery demo frontend with 20 dishes, search and category filters, offers, a cart, coupons, a demo checkout, and dark/light themes.

## Live website

https://shagunchauhan299-sudo.github.io/fodie/

## Run locally

This is a static website. It does not need Node.js, npm, or a build command.

- Download or clone this repository.
- Open `index.html` in a browser, or use VS Code Live Server.
- Keep the three `FoodieHub_Logo_*.svg` files and `.nojekyll` alongside `index.html`.

## Deploy automatically with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open the **Actions** tab and run **Deploy FoodieHub to GitHub Pages** if the automatic run has not started.
4. When the workflow succeeds, visit https://shagunchauhan299-sudo.github.io/fodie/

The workflow in `.github/workflows/deploy-pages.yml` deploys the static site whenever code is pushed to the `main` branch. It also supports manual runs from the Actions tab.

## What works in this demo

- Browse 20 sample dishes, search, categories, and sorting.
- Add items to the cart and change quantities.
- Apply the demo coupon codes `FOOD25` and `HUB50` when their cart minimums are met.
- Save favourites, theme preference, profile and demo order details in the current browser.
- Try the delivery-address and checkout flow.

## Important: demo checkout, not live ordering

GitHub Pages serves static files only. FoodieHub's current cart, profile, address, notifications, and demo orders use browser local storage. No order is sent to a restaurant or central database, and no real payment is processed.

For a production ordering service, connect a separate backend/API, database, authentication, and a payment provider. Do not put secret API keys in this public repository.

