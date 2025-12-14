import pkg from "pg";
const { Client } = pkg;

const client = new Client({
  user: "neondb_owner",
  host: "localhost",
  password: "npg_p7yYFTQkeBl2",
  port: 5432,
});

async function listDatabases() {
  try {
    await client.connect();
    const res = await client.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false;"
    );
    console.log("Databases on server:");
    res.rows.forEach((row) => console.log(row.datname));
  } catch (err) {
    console.error("Error listing databases:", err);
  } finally {
    await client.end();
  }
}

listDatabases();
