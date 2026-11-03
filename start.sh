#!/usr/bin/env bash
# Linux pair of start.bat: install if needed, open the browser, run dev.
cd "$(dirname "$0")" || exit 1
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies, please wait..."
  npm install || exit 1
fi
# node_modules shared with Windows may lack the Linux native bindings.
if [ ! -d "node_modules/@rolldown/binding-linux-x64-gnu" ]; then
  echo "Adding Linux native modules..."
  npm run deps:dual || exit 1
fi
echo "Starting Grafnot at http://localhost:5173 ..."
(sleep 2; xdg-open "http://localhost:5173" >/dev/null 2>&1) &
exec npm run dev
