// test-agencies.js
import pkg from "pg";
const { Pool } = pkg;

const db = new Pool({
  connectionString:
    "postgresql://neondb_owner:npg_p7yYFTQkeBl2@ep-empty-cake-ag9q30g1-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: {
    rejectUnauthorized: false,
  },
});

const getAgencies = async () => {
  try {
    const result = await db.query("SELECT * FROM agencies");
    console.log(result.rows);
  } catch (err) {
    console.error("Error querying agencies:", err);
  } finally {
    await db.end();
  }
};

getAgencies();
