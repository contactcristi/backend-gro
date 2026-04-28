const { Pool } = require('pg');
const { createApp } = require('./src/app');
const { createPostgresAccountStore } = require('./src/postgresAccountStore');

const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = createApp({
  accountStore: createPostgresAccountStore(pool),
  jwtSecret: process.env.JWT_SECRET,
  pool,
});

app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
