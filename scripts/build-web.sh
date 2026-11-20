#!/usr/bin/env bash
# Builds the web app (PC: 교재 관리 등) into docs/app, served by GitHub Pages at https://nathankim6.github.io/orun-note/app/
# docs/404.html is the same page, so a refresh on a deep link (…/app/admin) still opens the app.
set -euo pipefail
rm -rf web-dist docs/app
WEB_BASE_URL=/orun-note/app npx expo export -p web --output-dir web-dist
cp -R web-dist docs/app && cp web-dist/index.html docs/404.html && rm -rf web-dist
echo "built docs/app ($(du -sh docs/app | cut -f1))"
