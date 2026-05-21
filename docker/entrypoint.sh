#!/bin/sh
set -e

echo "Running database migrations..."
node dist/db/migrate.js

echo "Seeding wallets..."
SKIP_K6_MANIFEST=true node dist/db/seed.js

echo "Starting API..."
exec node dist/server.js
