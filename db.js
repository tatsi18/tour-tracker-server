// db.js
const { Pool } = require("pg");
const dotenv = require("dotenv");

// Load environment variables from .env file
dotenv.config();

const pool = new Pool({
  // We get the connection string from the .env file
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = {
  // This allows other files (like server.js) to execute database queries
  query: (text, params) => pool.query(text, params),
};
